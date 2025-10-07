// services/admin/monthlyClass.js
const moment = require("moment");
const {
    Booking,
    BookingStudentMeta,
    BookingParentMeta,
    BookingEmergencyMeta,
    ClassSchedule,
    Venue,
    BookingPayment,
    PaymentPlan,
    Admin,
} = require("../../models");

// ✅ Helper: sum sales for "paid" bookings
// Total business revenue (all bookings, paid + unpaid)
function totalRevenueSum(bookings) {
    return bookings
        .reduce((sum, b) => sum + Number(b.paymentPlan?.price || 0), 0);
}

// Revenue from paid bookings
function totalPaidRevenueSum(bookings) {
    return bookings
        .filter(b => b.bookingType === "paid")
        .reduce((sum, b) => sum + Number(b.paymentPlan?.price || 0), 0);
}

// Revenue from unpaid bookings
function totalUnpaidRevenueSum(bookings) {
    return bookings
        .filter(b => b.bookingType !== "paid")
        .reduce((sum, b) => sum + Number(b.paymentPlan?.price || 0), 0);
}

// ✅ Helper: count paid bookings
function countPaidBookings(bookings) {
    return bookings.filter((b) => b.bookingType === "paid").length;
}

// ✅ Helper: calculate percentage difference (for trend)
function calcPercentageDiff(currentStats, lastStats) {
    const current = currentStats.totalRevenue;
    const last = lastStats.totalRevenue;

    if (last === 0 && current === 0) return { percent: 0, color: "gray", message: "No change" };
    if (last === 0) return { percent: 100, color: "green", message: "Increased by 100%" };

    const diff = ((current - last) / last) * 100;
    return {
        percent: Math.abs(diff.toFixed(2)),
        color: diff >= 0 ? "green" : "red",
        message: diff >= 0 ? `Increased by ${Math.abs(diff.toFixed(2))}%` : `Decreased by ${Math.abs(diff.toFixed(2))}%`,
        currentMonthStats: currentStats,
        lastMonthStats: lastStats,
    };
}

// ✅ Group bookings by month with calculations
function groupBookingsByMonth(bookings, filter) {
    if (!bookings || bookings.length === 0) return {};

    bookings.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const startDate = moment(bookings[0].createdAt).startOf("month");
    const endDate = moment(bookings[bookings.length - 1].createdAt).endOf("month");

    const grouped = {};
    let current = startDate.clone();

    while (current.isSameOrBefore(endDate, 'month')) {
        const monthStart = current.clone();
        const monthEnd = current.clone().endOf("month");

        const key = monthStart.format("MM-YYYY");

        // Get bookings for this month
        const monthBookings = bookings.filter((b) =>
            moment(b.createdAt).isBetween(monthStart, monthEnd, null, "[]")
        );

        const durationOfMembership = calculateDurationOfMembership(monthBookings);

        // Total Sales and Booking Count
        const totalRevenue = totalRevenueSum(monthBookings);
        const totalPaidRevenue = totalPaidRevenueSum(monthBookings);
        const totalUnpaidRevenue = totalUnpaidRevenueSum(monthBookings);
        const bookingCount = monthBookings.length;
        const paidBookingCount = countPaidBookings(monthBookings);
        const unpaidBookingCount = bookingCount - paidBookingCount;

        const totalSales = { totalRevenue, totalPaidRevenue, totalUnpaidRevenue, bookingCount, paidBookingCount, unpaidBookingCount };

        // Agent-wise sales
        const agents = {};
        const filteredBookings = [];
        const newStudents = []
        const enrolledStudents = {
            byAge: {},
            byGender: {}
        };

        const now = moment(); // current date
        const currentMonth = now.month(); // 0-11
        const currentYear = now.year();

        monthBookings.forEach((b) => {
            let validFilterBooking = true;

            // ✅ Student Filter
            if (filter.student?.name?.trim()) {
                const searchName = filter.student.name.trim().toLowerCase();
                validFilterBooking = b.students?.some(studentMeta => {
                    const firstName = studentMeta.studentFirstName?.toLowerCase() || "";
                    const lastName = studentMeta.studentLastName?.toLowerCase() || "";
                    return firstName.includes(searchName) || lastName.includes(searchName);
                }) || false;
            }

            // ✅ Venue Filter
            if (filter.venue?.name?.trim()) {
                const searchName = filter.venue.name.trim().toLowerCase();
                const venueName = b.classSchedule?.venue?.name?.trim().toLowerCase() || "";
                validFilterBooking = venueName === searchName;
            }

            // ✅ Payment Plan Filter
            if (filter.paymentPlan?.interval?.trim() && filter.paymentPlan.duration > 0) {
                const searchInterval = filter.paymentPlan.interval.trim().toLowerCase();
                const searchDuration = Number(filter.paymentPlan.duration);

                const interval = b.paymentPlan?.interval?.trim().toLowerCase() || "";
                const duration = Number(b.paymentPlan?.duration || 0);

                validFilterBooking = interval === searchInterval && duration === searchDuration;
            }

            // ✅ Admin Filter
            if (filter.admin?.name?.trim()) {
                const searchName = filter.admin.name.trim().toLowerCase();
                const firstName = b.bookedByAdmin?.firstName?.trim().toLowerCase() || "";
                const lastName = b.bookedByAdmin?.lastName?.trim().toLowerCase() || "";
                validFilterBooking = firstName.includes(searchName) || lastName.includes(searchName);
            }

            if (validFilterBooking) filteredBookings.push(b);

            // New Students
            b.students.forEach(studentMeta => {
                const studentCreatedAt = moment(studentMeta.createdAt);
                if (studentCreatedAt.month() === currentMonth && studentCreatedAt.year() === currentYear) {
                    newStudents.push(studentMeta);
                }

                const birthDate = studentMeta.dateOfBirth; // assume DOB available
                if (birthDate) {
                    const age = moment().diff(moment(birthDate), 'years');
                    if (!enrolledStudents.byAge[age]) enrolledStudents.byAge[age] = 0;
                    enrolledStudents.byAge[age] += 1;
                }

                // ✅ Gender
                const gender = (studentMeta.gender || "other").toLowerCase();
                if (!enrolledStudents.byGender[gender]) enrolledStudents.byGender[gender] = 0;
                enrolledStudents.byGender[gender] += 1;
            });

            // ✅ Agent-wise sales
            const admin = b.bookedByAdmin;
            if (!admin) return;
            const price = Number(b.paymentPlan?.price || 0);

            if (!agents[admin.id]) {
                agents[admin.id] = {
                    id: admin.id,
                    name: `${admin.firstName} ${admin.lastName}`,
                    totalSales: { totalRevenue: 0, totalPaidRevenue: 0, totalUnpaidRevenue: 0, bookingCount: 0, paidBookingCount: 0, unpaidBookingCount: 0 },
                };
            }

            agents[admin.id].totalSales.bookingCount += 1;
            agents[admin.id].totalSales.totalRevenue += price;
            if (b.bookingType === "paid") {
                agents[admin.id].totalSales.totalPaidRevenue += price;
                agents[admin.id].totalSales.paidBookingCount += 1;
            } else {
                agents[admin.id].totalSales.totalUnpaidRevenue += price;
                agents[admin.id].totalSales.unpaidBookingCount += 1;
            }
        });

        // Sort agents by totalRevenue
        const topAgents = Object.values(agents).sort(
            (a, b) => b.totalSales.totalRevenue - a.totalSales.totalRevenue
        );

        grouped[key] = {
            bookings: filteredBookings,
            totalSales,
            topAgents,
            trend: {},
            newStudents,
            durationOfMembership,
            enrolledStudents
        };

        current.add(1, "month");
    }

    // Add month-over-month trend
    const monthKeys = Object.keys(grouped);
    monthKeys.forEach((key, index) => {
        if (index === 0) {
            grouped[key].trend = {
                percent: 0,
                color: "gray",
                message: "No previous month",
                currentMonthStats: grouped[key].totalSales,
                lastMonthStats: null
            };
        } else {
            const currentMonthStats = grouped[key].totalSales;
            const lastMonthStats = grouped[monthKeys[index - 1]].totalSales;
            grouped[key].trend = calcPercentageDiff(currentMonthStats, lastMonthStats);
        }
    });

    return grouped;
}

// Helper: Convert payment plan to months
function convertDurationToMonths(paymentPlan) {
    if (!paymentPlan) return 0;
    const interval = (paymentPlan.interval || "").toLowerCase();
    const duration = Number(paymentPlan.duration || 0);

    switch (interval) {
        case "year":
            return duration * 12;
        case "quarter":
            return duration * 3; // each quarter = 3 months
        case "month":
        default:
            return duration;
    }
}

// Helper: Generate duration ranges dynamically
function generateDurationRanges(maxMonths = 24, step = 2) {
    const ranges = [];
    for (let start = 1; start <= maxMonths; start += step) {
        const end = start + step - 1;
        ranges.push({ label: `${start}-${end} Months`, min: start, max: end, bookings: 0 });
    }
    return ranges;
}

// Function to calculate durationOfMembership
function calculateDurationOfMembership(bookings) {
    const ranges = generateDurationRanges(24, 2); // ranges up to 24 months with 2-month step

    bookings.forEach(b => {
        const months = convertDurationToMonths(b.paymentPlan);
        const range = ranges.find(r => months >= r.min && months <= r.max);
        if (range) range.bookings += 1;
    });

    // Convert to object format for sending
    const result = {};
    ranges.forEach(r => {
        if (r.bookings > 0) {
            result[r.label] = { bookings: r.bookings };
        }
    });
    return result;
}


// ✅ Main Monthly Class Report
const getMonthlyClassReport = async (filters) => {
    try {
        const bookings = await Booking.findAll({
            order: [["id", "DESC"]],
            include: [
                {
                    model: BookingStudentMeta,
                    as: "students",
                    include: [
                        { model: BookingParentMeta, as: "parents", required: false },
                        { model: BookingEmergencyMeta, as: "emergencyContacts", required: false },
                    ],
                    required: false,
                },
                {
                    model: ClassSchedule,
                    as: "classSchedule",
                    required: false,
                    include: [{ model: Venue, as: "venue", required: false }],
                },
                { model: BookingPayment, as: "payments", required: false },
                { model: PaymentPlan, as: "paymentPlan", required: false },
                {
                    model: Admin,
                    as: "bookedByAdmin",
                    attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"],
                    required: false,
                },
            ],
        });

        const monthlyGrouped = groupBookingsByMonth(bookings, filters);

        // ✅ Calculate overall trend
        const overallSales = {
            totalRevenue: 0,
            totalPaidRevenue: 0,
            totalUnpaidRevenue: 0,
            bookingCount: 0,
            paidBookingCount: 0,
            unpaidBookingCount: 0,
        };

        Object.values(monthlyGrouped).forEach(month => {
            overallSales.totalRevenue += month.totalSales.totalRevenue;
            overallSales.totalPaidRevenue += month.totalSales.totalPaidRevenue;
            overallSales.totalUnpaidRevenue += month.totalSales.totalUnpaidRevenue;
            overallSales.bookingCount += month.totalSales.bookingCount;
            overallSales.paidBookingCount += month.totalSales.paidBookingCount;
            overallSales.unpaidBookingCount += month.totalSales.unpaidBookingCount;
        });

        return {
            status: true,
            message: "Monthly class report generated successfully.",
            data: { monthlyGrouped, overallSales },
        };
    } catch (error) {
        console.error("❌ Sequelize Error in getMonthlyClassReport:", error);
        return {
            status: false,
            message:
                error?.parent?.sqlMessage ||
                error?.message ||
                "Error occurred while generating monthly class report.",
        };
    }
};

module.exports = {
    getMonthlyClassReport,
};
