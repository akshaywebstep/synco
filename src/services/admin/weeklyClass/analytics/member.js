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
} = require("../../../../models");

// Helper functions
function totalRevenueSum(bookings) {
    return bookings.reduce((sum, b) => {
        if (b.paymentPlan && typeof b.paymentPlan.price === 'number' && Array.isArray(b.students)) {
            const totalStudents = b.students.length;
            sum += b.paymentPlan.price * totalStudents;
        }
        return sum;
    }, 0);
}

function totalPaidRevenueSum(bookings) {
    return bookings
        .filter(b => b.bookingType === "paid" && b.paymentPlan && Array.isArray(b.students))
        .reduce((sum, b) => {
            const totalStudents = b.students.length;
            sum += b.paymentPlan.price * totalStudents;
            return sum;
        }, 0);
}

function totalPaidRevenueSum(bookings) {
    return bookings
        .filter(b => b.bookingType !== "paid" && b.paymentPlan && Array.isArray(b.students))
        .reduce((sum, b) => {
            const totalStudents = b.students.length;
            sum += b.paymentPlan.price * totalStudents;
            return sum;
        }, 0);
}

function countPaidBookings(bookings) {
    return bookings.filter(b => b.bookingType === "paid").length;
}

function calcPercentageDiff(currentStats, lastStats, isYear = false) {
    if (!lastStats) {
        return {
            percent: 0,
            color: "gray",
            message: "No previous data",
            ...(isYear ? { currentYearStats: currentStats, lastYearStats: null } : { currentMonthStats: currentStats, lastMonthStats: null })
        };
    }

    const current = currentStats.totalRevenue;
    const last = lastStats.totalRevenue;

    if (last === 0 && current === 0) return { percent: 0, color: "gray", message: "No change" };

    const diff = ((current - last) / last) * 100;
    return {
        percent: Math.abs(diff.toFixed(2)),
        color: diff >= 0 ? "green" : "red",
        message: diff >= 0 ? `Increased by ${Math.abs(diff.toFixed(2))}%` : `Decreased by ${Math.abs(diff.toFixed(2))}%`,
        ...(isYear ? { currentYearStats: currentStats, lastYearStats: lastStats } : { currentMonthStats: currentStats, lastMonthStats: lastStats })
    };
}

function convertDurationToMonths(paymentPlan) {
    if (!paymentPlan) return 0;
    const interval = (paymentPlan.interval || "").toLowerCase();
    const duration = Number(paymentPlan.duration || 0);
    switch (interval) {
        case "year": return duration * 12;
        case "quarter": return duration * 3;
        default: return duration;
    }
}

function generateDurationRanges(maxMonths = 24, step = 2) {
    const ranges = [];
    for (let start = 1; start <= maxMonths; start += step) {
        const end = start + step - 1;
        ranges.push({ label: `${start}-${end} Months`, min: start, max: end, bookings: 0 });
    }
    return ranges;
}

function calculateDurationOfMembership(bookings) {
    const ranges = generateDurationRanges(24, 2); // generates ranges like 1-2, 3-4, ..., 23-24

    bookings.forEach(b => {
        const months = convertDurationToMonths(b.paymentPlan);
        const range = ranges.find(r => months >= r.min && months <= r.max);
        if (range) {
            range.bookings += 1;
            range.students = (range.students || 0) + (b.students?.length || 0);
        }
    });

    const result = {};
    ranges.forEach(r => {
        if (r.bookings > 0) {
            result[r.label] = {
                bookings: r.bookings,
                students: r.students || 0
            };
        }
    });

    return result;
}

// Group bookings by Year → Month
function groupBookingsByYearMonth(bookings, filter) {
    if (!bookings || bookings.length === 0) return {};

    bookings.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const startDate = moment(bookings[0].createdAt).startOf("month");
    const endDate = moment(bookings[bookings.length - 1].createdAt).endOf("month");

    const grouped = {};
    let current = startDate.clone();

    while (current.isSameOrBefore(endDate, "month")) {
        const yearKey = current.format("YYYY");
        const monthKey = current.format("MM");

        const monthBookings = bookings.filter(b => moment(b.createdAt).isBetween(current.clone().startOf("month"), current.clone().endOf("month"), null, "[]"));

        const durationOfMembership = calculateDurationOfMembership(monthBookings);

        const totalRevenue = totalRevenueSum(monthBookings);
        const totalPaidRevenue = totalPaidRevenueSum(monthBookings);
        const totalUnpaidRevenue = totalUnpaidRevenueSum(monthBookings);
        const bookingCount = monthBookings.length;
        const paidBookingCount = countPaidBookings(monthBookings);
        const unpaidBookingCount = bookingCount - paidBookingCount;

        const totalSales = { totalRevenue, totalPaidRevenue, totalUnpaidRevenue, bookingCount, paidBookingCount, unpaidBookingCount };

        const agents = [];
        const filteredBookings = [];
        const newStudents = [];
        const enrolledStudents = { byAge: {}, byGender: {} };
        const paymentPlansTrend = [];

        monthBookings.forEach(b => {
            let valid = true;

            if (b.paymentPlan) {
                // Check if this paymentPlan.id already exists in paymentPlansTrend
                const existingPlan = paymentPlansTrend.find(p => p.id === b.paymentPlan.id);

                if (!existingPlan) {
                    // Push new plan
                    paymentPlansTrend.push({
                        id: b.paymentPlan.id,
                        title: b.paymentPlan.title,
                        price: b.paymentPlan.price,
                        priceLesson: b.paymentPlan.priceLesson,
                        interval: b.paymentPlan.interval,
                        duration: b.paymentPlan.duration,
                        joiningFee: b.paymentPlan.joiningFee,
                        students: b.students?.length || 0
                    });
                } else {
                    // Update existing plan's students count
                    existingPlan.students += b.students?.length || 0;
                }
            }

            // Student filter
            if (filter.student?.name?.trim()) {
                const search = filter.student.name.trim().toLowerCase();
                valid = b.students?.some(s => ((s.studentFirstName || "").toLowerCase().includes(search)) || ((s.studentLastName || "").toLowerCase().includes(search))) || false;
            }

            // Venue filter
            if (valid && filter.venue?.name?.trim()) {
                const search = filter.venue.name.trim().toLowerCase();
                valid = ((b.classSchedule?.venue?.name || "").toLowerCase() === search);
            }

            // PaymentPlan filter
            if (valid && filter.paymentPlan?.interval?.trim() && filter.paymentPlan.duration > 0) {
                const searchInterval = filter.paymentPlan.interval.trim().toLowerCase();
                const searchDuration = Number(filter.paymentPlan.duration);
                const interval = (b.paymentPlan?.interval || "").toLowerCase();
                const duration = Number(b.paymentPlan?.duration || 0);
                valid = interval === searchInterval && duration === searchDuration;
            }

            // Admin filter
            if (valid && filter.admin?.name?.trim()) {
                const search = filter.admin.name.trim().toLowerCase();
                const firstName = (b.bookedByAdmin?.firstName || "").toLowerCase();
                const lastName = (b.bookedByAdmin?.lastName || "").toLowerCase();
                valid = firstName.includes(search) || lastName.includes(search);
            }

            if (valid) filteredBookings.push(b);

            // Students
            b.students.forEach(s => {
                const studentCreatedAt = moment(s.createdAt);
                if (studentCreatedAt.month() === current.month() && studentCreatedAt.year() === current.year()) newStudents.push(s);

                if (s.dateOfBirth) {
                    const age = moment().diff(moment(s.dateOfBirth), 'years');
                    enrolledStudents.byAge[age] = (enrolledStudents.byAge[age] || 0) + 1;
                }

                const gender = (s.gender || "other").toLowerCase();
                enrolledStudents.byGender[gender] = (enrolledStudents.byGender[gender] || 0) + 1;
            });

            // Agents
            const admin = b.bookedByAdmin;
            if (!admin) return;
            const price = Number(b.paymentPlan?.price || 0);
            if (!agents[admin.id]) agents[admin.id] = { id: admin.id, name: `${admin.firstName} ${admin.lastName}`, totalSales: { totalRevenue: 0, totalPaidRevenue: 0, totalUnpaidRevenue: 0, bookingCount: 0, paidBookingCount: 0, unpaidBookingCount: 0 } };

            const newStudentsCount = b.students.filter(student => {
                const studentCreatedAt = moment(student.createdAt);
                return (
                    studentCreatedAt.month() === current.month() &&
                    studentCreatedAt.year() === current.year()
                );
            }).length;

            agents[admin.id].totalSales.bookingCount += 1;
            agents[admin.id].totalSales.totalRevenue += (price * newStudentsCount);
            if (b.bookingType === "paid") {
                agents[admin.id].totalSales.totalPaidRevenue += (price * newStudentsCount);
                agents[admin.id].totalSales.paidBookingCount += 1;
            } else {
                agents[admin.id].totalSales.totalUnpaidRevenue += (price * newStudentsCount);
                agents[admin.id].totalSales.unpaidBookingCount += 1;
            }
        });

        const topAgents = Object.values(agents).sort((a, b) => b.totalSales.totalRevenue - a.totalSales.totalRevenue);

        if (!grouped[yearKey]) grouped[yearKey] = { monthlyGrouped: {} };
        grouped[yearKey].monthlyGrouped[monthKey] = { bookings: filteredBookings, totalSales, topAgents, salesTrend: {}, newStudents, durationOfMembership, enrolledStudents, paymentPlansTrend };

        current.add(1, "month");
    }

    // Month-over-month trends
    Object.keys(grouped).forEach(yearKey => {
        const months = Object.keys(grouped[yearKey].monthlyGrouped).sort();
        months.forEach((monthKey, i) => {
            const monthData = grouped[yearKey].monthlyGrouped[monthKey];
            if (i === 0) {
                monthData.salesTrend = calcPercentageDiff(monthData.totalSales, null);
                monthData.topAgents = monthData.topAgents.map(agent => {
                    const { totalSales, ...rest } = agent;
                    return { ...rest, salesTrend: calcPercentageDiff(totalSales, null) };
                });
            } else {
                const lastMonthKey = months[i - 1];
                const lastMonthData = grouped[yearKey].monthlyGrouped[lastMonthKey];
                monthData.salesTrend = calcPercentageDiff(monthData.totalSales, lastMonthData.totalSales);
                monthData.topAgents = monthData.topAgents.map(agent => {
                    const prev = lastMonthData.topAgents.find(a => a.id === agent.id);
                    const { totalSales, ...rest } = agent;
                    return { ...rest, salesTrend: calcPercentageDiff(agent.totalSales, prev ? prev.totalSales : null) };
                });
            }
            delete monthData.totalSales;
        });

        // Yearly salesTrend
        const yearTotal = { totalRevenue: 0, totalPaidRevenue: 0, totalUnpaidRevenue: 0, bookingCount: 0, paidBookingCount: 0, unpaidBookingCount: 0 };
        const lastYearTotal = grouped[String(Number(yearKey) - 1)]?.yearlyTotal || null;

        Object.values(grouped[yearKey].monthlyGrouped).forEach(m => {
            const monthStats = m.salesTrend.currentMonthStats;
            yearTotal.totalRevenue += monthStats.totalRevenue;
            yearTotal.totalPaidRevenue += monthStats.totalPaidRevenue;
            yearTotal.totalUnpaidRevenue += monthStats.totalUnpaidRevenue;
            yearTotal.bookingCount += monthStats.bookingCount;
            yearTotal.paidBookingCount += monthStats.paidBookingCount;
            yearTotal.unpaidBookingCount += monthStats.unpaidBookingCount;
        });

        grouped[yearKey].salesTrend = calcPercentageDiff(yearTotal, lastYearTotal, true);
    });

    return grouped;
}

// Main Report
const getMonthlyReport = async (filters) => {
    try {
        const bookings = await Booking.findAll({
            order: [["id", "DESC"]],
            where: { bookingType: 'paid' },
            include: [
                { model: BookingStudentMeta, as: "students", include: [{ model: BookingParentMeta, as: "parents", required: false }, { model: BookingEmergencyMeta, as: "emergencyContacts", required: false }], required: false },
                { model: ClassSchedule, as: "classSchedule", required: false, include: [{ model: Venue, as: "venue", required: false }] },
                { model: BookingPayment, as: "payments", required: false },
                { model: PaymentPlan, as: "paymentPlan", required: false },
                { model: Admin, as: "bookedByAdmin", attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"], required: false },
            ],
        });

        const yealyGrouped = groupBookingsByYearMonth(bookings, filters);

        // Overall Sales
        const overallSales = { totalRevenue: 0, totalPaidRevenue: 0, totalUnpaidRevenue: 0, bookingCount: 0, paidBookingCount: 0, unpaidBookingCount: 0 };
        Object.values(yealyGrouped).forEach(year => {
            Object.values(year.monthlyGrouped).forEach(month => {
                const s = month.salesTrend.currentMonthStats;
                overallSales.totalRevenue += s.totalRevenue;
                overallSales.totalPaidRevenue += s.totalPaidRevenue;
                overallSales.totalUnpaidRevenue += s.totalUnpaidRevenue;
                overallSales.bookingCount += s.bookingCount;
                overallSales.paidBookingCount += s.paidBookingCount;
                overallSales.unpaidBookingCount += s.unpaidBookingCount;
            });
        });

        return { status: true, message: "Monthly class report generated successfully.", data: { yealyGrouped, overallSales } };
    } catch (error) {
        console.error("❌ Sequelize Error:", error);
        return { status: false, message: error?.parent?.sqlMessage || error?.message || "Error occurred while generating monthly class report." };
    }
};

module.exports = { getMonthlyReport };
