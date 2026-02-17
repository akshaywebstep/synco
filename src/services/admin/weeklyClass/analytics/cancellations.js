const { Op } = require("sequelize");
const moment = require("moment");
const {
    Booking,
    BookingStudentMeta,
    BookingPayment,
    ClassSchedule,
    Venue,
    CancelBooking,
    PaymentPlan,
    Admin,
} = require("../../../../models");

function getYearRange(year) {
    return {
        start: moment().year(year).startOf("year").toDate(),
        end: moment().year(year).endOf("year").toDate(),
    };
}

function getMonthRange(monthOffset = 0) {
    const start = moment().startOf("month").add(monthOffset, "months").toDate();
    const end = moment().endOf("month").add(monthOffset, "months").toDate();
    return { start, end };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 🧩 Utility: build where conditions based on admin hierarchy
async function buildAccessConditions(superAdminId, adminId, filters = {}) {
    const whereLead = {};
    const whereVenue = {};
    const whereSchedule = {};
    const whereBooking = {};

    if (filters.venueId) {
        whereBooking.venueId = filters.venueId;
    }

    if (superAdminId && superAdminId === adminId) {
        // ✅ Super Admin — include all managed admins + self
        const managedAdmins = await Admin.findAll({
            where: { superAdminId },
            attributes: ["id"],
        });

        const adminIds = managedAdmins.map((a) => a.id);
        adminIds.push(superAdminId);

        whereLead.createdBy = { [Op.in]: adminIds };
        whereVenue.createdBy = { [Op.in]: adminIds };
        whereSchedule.createdBy = { [Op.in]: adminIds };
        whereBooking.bookedBy = { [Op.in]: adminIds };
    } else {
        // ✅ Normal Admin — include own + super admin’s records
        whereLead.createdBy = { [Op.in]: [adminId, superAdminId] };
        whereVenue.createdBy = { [Op.in]: [adminId, superAdminId] };
        whereSchedule.createdBy = { [Op.in]: [adminId, superAdminId] };
        whereBooking.bookedBy = { [Op.in]: [adminId, superAdminId] };
    }

    return { whereLead, whereVenue, whereSchedule, whereBooking };
}

/* ---------------------------------------------------
   🏟️ Venues Used in Cancelled Bookings — Filter by Student Age
--------------------------------------------------- */
function getAgeFilter(age) {
    if (!age || age === "allAges") return null;

    // exact age (e.g. ?age=1)
    if (!isNaN(age)) {
        return { age: Number(age) };
    }

    if (age === "under18") return { age: { [Op.lt]: 18 } };
    if (age === "18-25") return { age: { [Op.between]: [18, 25] } };

    return null;
}

async function applyGlobalFilters(filters = {}) {
    let cancelWhere = {};

    if (filters.period) {
        const range = getPeriodRange(filters.period);
        if (range) {
            cancelWhere.createdAt = {
                [Op.between]: [range.start, range.end],
            };
        }
    }

    const ageFilter = getAgeFilter(filters.age);

    const studentInclude = {
        model: BookingStudentMeta,
        as: "students",
        attributes: [],
        where: ageFilter || undefined,
        required: !!ageFilter,
    };

    return { cancelWhere, studentInclude };
}

async function getAllVenuesUsedInCancelled(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    const ageFilter = getAgeFilter(filters.age);

    const cancelledBookings = await Booking.findAll({
        where: {
            ...whereBooking,
            status: "cancelled",
        },
        attributes: ["id", "venueId"],
        include: [
            {
                model: BookingStudentMeta,
                as: "students",
                attributes: ["age"],
                where: ageFilter || undefined,
                required: !!ageFilter, // only filter if age provided
            },
            {
                model: Venue,
                as: "venue",
                attributes: ["id", "name"],
            },
        ],
        raw: true,
        nest: true,
    });

    const venueMap = {};
    cancelledBookings.forEach(c => {
        if (c.venue?.id && !venueMap[c.venue.id]) {
            venueMap[c.venue.id] = {
                id: c.venue.id,
                name: c.venue.name,
            };
        }
    });

    return Object.values(venueMap);
}

/* ---------------------------------------------------
   🧮 Correct RTC Count — based on CancelBooking.createdAt
--------------------------------------------------- */
async function getTotalRTCs(superAdminId, adminId, filters, year) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const { start, end } = getYearRange(year);
    const { cancelWhere, studentInclude } = await applyGlobalFilters(filters);

    return await CancelBooking.count({
        where: cancelWhere,
        include: [
            {
                model: Booking,
                as: "booking",
                where: { ...whereBooking, status: "request_to_cancel" },
                attributes: [],
                include: studentInclude ? [studentInclude] : [],
            },
        ],
        distinct: true,
        col: "bookingId",
    });
}

async function getRTCYearComparison(superAdminId, adminId, filters) {
    const currentYear = moment().year();
    const previousYear = currentYear - 1;

    const [thisYear, lastYearCount] = await Promise.all([
        getTotalRTCs(superAdminId, adminId, filters, currentYear),
        getTotalRTCs(superAdminId, adminId, filters, previousYear),
    ]);

    const change =
        lastYearCount === 0
            ? thisYear === 0
                ? "0%"
                : "+100%"
            : `${(((thisYear - lastYearCount) / lastYearCount) * 100).toFixed(2)}%`;

    return {
        thisYear,
        lastYear: lastYearCount,
        change,
    };
}

/* ---------------------------------------------------
   ❌ 2️⃣ Total Cancellations — from CancelBooking table
--------------------------------------------------- */
/* ---------------------------------------------------
   ❌ Total Cancellations — based on CancelBooking.createdAt
--------------------------------------------------- */
async function getTotalCancelled(superAdminId, adminId, filters, year) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const { start, end } = getYearRange(year);
    const { cancelWhere, studentInclude } = await applyGlobalFilters(filters);

    return await CancelBooking.count({
        where: cancelWhere,
        include: [
            {
                model: Booking,
                as: "booking",
                where: { ...whereBooking, status: "cancelled" },
                attributes: [],
                include: studentInclude ? [studentInclude] : [],
            },
        ],
        distinct: true,
        col: "bookingId",
    });
}

async function getTotalCancelledYearComparison(superAdminId, adminId, filters) {
    const currentYear = moment().year();
    const previousYear = currentYear - 1;

    const [thisYear, lastYearCount] = await Promise.all([
        getTotalCancelled(superAdminId, adminId, filters, currentYear),
        getTotalCancelled(superAdminId, adminId, filters, previousYear),
    ]);

    const change =
        lastYearCount === 0
            ? thisYear === 0
                ? "0%"
                : "+100%"
            : `${(((thisYear - lastYearCount) / lastYearCount) * 100).toFixed(2)}%`;

    return {
        thisYear,
        lastYear: lastYearCount,
        change,
    };
}

/* ---------------------------------------------------
   💸 3️⃣ Monthly Revenue Lost — from cancelled bookings
   Only includes bookings that have a PaymentPlan
--------------------------------------------------- */
async function getMonthlyRevenueLost(superAdminId, adminId, filters, monthOffset = 0) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const { cancelWhere, studentInclude } = await applyGlobalFilters(filters);

    const rows = await CancelBooking.findAll({
        where: cancelWhere,
        include: [
            {
                model: Booking,
                as: "booking",
                where: { ...whereBooking, status: "cancelled", paymentPlanId: { [Op.ne]: null } },
                attributes: ["id", "paymentPlanId"],
                include: [
                    studentInclude,
                    {
                        model: PaymentPlan,
                        as: "paymentPlan",
                        attributes: ["id", "price"],
                    },
                ].filter(Boolean),
            },
        ],
    });

    const cancelledWithPlan = rows
        .filter(row => row.booking?.paymentPlan)
        .map(row => ({
            bookingId: row.booking.id,
            paymentPlanId: row.booking.paymentPlan.id,
            price: row.booking.paymentPlan.price || 0,
        }));

    const totalLost = cancelledWithPlan.reduce((sum, item) => sum + item.price, 0);

    return {
        totalLost: parseFloat(totalLost.toFixed(2)),
        cancelledPaymentPlans: cancelledWithPlan,
    };
}

async function getMonthlyRevenueLostComparison(superAdminId, adminId, filters) {
    const [thisMonthData, lastMonthData] = await Promise.all([
        getMonthlyRevenueLost(superAdminId, adminId, filters, 0),
        getMonthlyRevenueLost(superAdminId, adminId, filters, -1),
    ]);

    const change =
        lastMonthData.totalLost === 0
            ? thisMonthData.totalLost === 0
                ? "0%"
                : "+100%"
            : `${(((thisMonthData.totalLost - lastMonthData.totalLost) / lastMonthData.totalLost) * 100).toFixed(2)}%`;

    // ✅ Format response like your example
    return {
        monthlyRevenueLost: {
            thisMonth: {
                totalLost: thisMonthData.totalLost,
            },
            lastMonth: {
                totalLost: lastMonthData.totalLost,
            },
            change,
        },
    };
}

// Properly call the function and log the result
// getMonthlyRevenueLostComparison(1, 2, {})
//     .then(result => console.log(JSON.stringify(result, null, 4)))
//     .catch(err => console.error(err));

/* ---------------------------------------------------
   🧾 4️⃣ Average Membership Tenure — via PaymentPlan
   Only considers cancelled bookings, grouped by year
--------------------------------------------------- */
async function getAvgMembershipTenure(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    whereBooking.paymentPlanId = { [Op.not]: null };
    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);

    const cancelledBookings = await CancelBooking.findAll({
        include: [
            {
                model: Booking,
                as: "booking",
                where: { ...whereBooking, status: "cancelled" },
                attributes: ["id", "paymentPlanId"],
                include: [
                    studentInclude,
                    { model: PaymentPlan, as: "paymentPlan", attributes: ["duration"] },
                ].filter(Boolean),
            },
        ],
    });

    const calcAvg = bookings => {
        const durations = bookings.map(b => b.booking?.paymentPlan?.duration || 0).filter(d => d > 0);
        return durations.length === 0 ? 0 : parseFloat((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1));
    };

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    const thisYearBookings = cancelledBookings.filter(b => b.createdAt.getFullYear() === currentYear);
    const lastYearBookings = cancelledBookings.filter(b => b.createdAt.getFullYear() === lastYear);

    const thisYearAvg = calcAvg(thisYearBookings);
    const lastYearAvg = calcAvg(lastYearBookings);

    const change = lastYearAvg === 0 ? (thisYearAvg === 0 ? "0%" : "+100%") : `${(((thisYearAvg - lastYearAvg) / lastYearAvg) * 100).toFixed(2)}%`;

    return { thisYear: thisYearAvg, lastYear: lastYearAvg, change };
}

// Example usage
// getAvgMembershipTenure(1, 2, {})
//     .then(result => console.log(JSON.stringify(result, null, 4)))
//     .catch(err => console.error(err));

/* ---------------------------------------------------
   🧊 5️⃣ Reactivated Memberships — reactivate = true AND status = active
   Count reactivated memberships per year
--------------------------------------------------- */
async function getReactivatedMembership(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    const countByYear = async (year) => {
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31, 23, 59, 59);
        return await Booking.count({
            where: { ...whereBooking, reactivate: "true", status: "active", createdAt: { [Op.between]: [start, end] } },
            include: studentInclude ? [studentInclude] : [],
        });
    };

    const [thisYearCount, lastYearCount] = await Promise.all([countByYear(currentYear), countByYear(lastYear)]);

    const change = lastYearCount === 0 ? (thisYearCount === 0 ? "0%" : "+100%") : `${(((thisYearCount - lastYearCount) / lastYearCount) * 100).toFixed(2)}%`;

    return { thisYear: thisYearCount, lastYear: lastYearCount, change };
}

// Example usage
// getReactivatedMembership(1, 2, {})
//     .then(result => console.log(JSON.stringify(result, null, 4)))
//     .catch(err => console.error(err));

/* ---------------------------------------------------
   👶 6️⃣ Total New Students — via BookingStudentMeta
   Only active bookings, counted per year
--------------------------------------------------- */
async function getTotalNewStudents(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);
    // Only consider active bookings
    whereBooking.status = "active";

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    // Helper to count students per year
    const countStudentsByYear = async (year) => {
        const start = new Date(year, 0, 1); // Jan 1
        const end = new Date(year, 11, 31, 23, 59, 59); // Dec 31

        const bookings = await Booking.findAll({
            where: {
                ...whereBooking,
                createdAt: { [Op.between]: [start, end] },
            },
            include: [
                studentInclude || {
                    model: BookingStudentMeta,
                    as: "students",
                    attributes: ["id"],
                },
            ].filter(Boolean),
        });

        // Sum students per booking
        return bookings.reduce((sum, b) => sum + (b.students?.length || 0), 0);
    };

    const [thisYearTotal, lastYearTotal] = await Promise.all([
        countStudentsByYear(currentYear),
        countStudentsByYear(lastYear),
    ]);

    // Calculate change
    const change =
        lastYearTotal === 0
            ? thisYearTotal === 0
                ? "0%"
                : "+100%"
            : `${(((thisYearTotal - lastYearTotal) / lastYearTotal) * 100).toFixed(2)}%`;

    return {
        thisYear: thisYearTotal,
        lastYear: lastYearTotal,
        change,
    };
}

/* ---------------------------------------------------
   ❌ Cancellation Reasons — current year summary only
--------------------------------------------------- */
async function getCancellationReasons(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const currentYear = moment().year();
    const { cancelWhere } = await applyGlobalFilters(filters);

    // Fetch all cancelled bookings for the current year
    const cancellationsThisYear = await CancelBooking.findAll({
        where: cancelWhere,
        include: [
            {
                model: Booking,
                as: "booking",
                where: {
                    ...whereBooking,
                    status: "cancelled",
                },
                attributes: [],
            },
        ],
    });

    // Aggregate cancellation reasons from CancelBooking table
    const reasonCounts = {};
    cancellationsThisYear.forEach(c => {
        const reason = c.cancelReason || "Other";
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });

    const totalCancellations = cancellationsThisYear.length;

    const reasons = Object.entries(reasonCounts).map(([reason, count]) => ({
        reason,
        count,
        percentage: totalCancellations ? parseFloat(((count / totalCancellations) * 100).toFixed(2)) : 0,
    }));

    return {
        total: totalCancellations,
        reasons,
    };
}

/* ---------------------------------------------------
   ❌ 7️⃣ Monthly Cancellations & Reasons — current year
   cancellationReason is in CancelBooking table
--------------------------------------------------- */
async function getMonthlyCancellations(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);

    const currentYear = moment().year();
    const years = [currentYear, currentYear - 1]; // ✅ 2026, 2025

    const chart = {};

    for (const year of years) {
        chart[year] = [];

        for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
            const range = {
                start: moment().year(year).month(monthIndex).startOf("month").toDate(),
                end: moment().year(year).month(monthIndex).endOf("month").toDate(),
            };

            const cancelled = await CancelBooking.count({
                where: {
                    createdAt: {
                        [Op.between]: [range.start, range.end],
                    },
                },
                include: [
                    {
                        model: Booking,
                        as: "booking",
                        where: {
                            ...whereBooking,
                            status: "cancelled",
                        },
                        attributes: [],
                        include: studentInclude ? [studentInclude] : [],
                    },
                ],
            });

            chart[year].push({
                month: MONTHS[monthIndex],
                cancelled,
            });
        }
    }

    return { chart };
}

/* ---------------------------------------------------
   👶 8️⃣ Cancelled Students — By Age & By Gender (Current Year)
--------------------------------------------------- */
async function getCancellStudentByAgeAndByGender(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    const currentYear = moment().year();
    const { cancelWhere } = await applyGlobalFilters(filters);

    // 1️⃣ Fetch all cancelled bookings for current year
    const cancelledBookings = await Booking.findAll({
        where: {
            ...whereBooking,
            status: "cancelled",
            ...cancelWhere,
        },
        attributes: ["id"],
        raw: true,
    });

    if (cancelledBookings.length === 0) {
        return { total: 0, byAge: [], byGender: [] };
    }

    const bookingIds = cancelledBookings.map(b => b.id);

    // 2️⃣ Fetch all student meta for cancelled bookings
    const students = await BookingStudentMeta.findAll({
        where: { bookingTrialId: { [Op.in]: bookingIds } },
        attributes: ["age", "gender"],
        raw: true,
    });

    if (students.length === 0) {
        return { total: 0, byAge: [], byGender: [] };
    }

    const total = students.length;

    // 3️⃣ Group by Age
    const ageCounts = {};
    students.forEach(s => {
        const age = s.age ? s.age.toString() : "Unknown";
        ageCounts[age] = (ageCounts[age] || 0) + 1;
    });

    const byAge = Object.keys(ageCounts).map(age => ({
        age,
        count: ageCounts[age],
        percentage: parseFloat(((ageCounts[age] / total) * 100).toFixed(2)),
    }));

    byAge.sort((a, b) => b.count - a.count);

    // 4️⃣ Group by Gender
    const genderCounts = {};
    students.forEach(s => {
        const gender = s.gender || "Unknown";
        genderCounts[gender] = (genderCounts[gender] || 0) + 1;
    });

    const byGender = Object.keys(genderCounts).map(gender => ({
        gender,
        count: genderCounts[gender],
        percentage: parseFloat(((genderCounts[gender] / total) * 100).toFixed(2)),
    }));

    byGender.sort((a, b) => b.count - a.count);

    return {
        total,
        byAge,
        byGender,
    };
}

/* ---------------------------------------------------
   💠 9️⃣ Membership Plans Most Cancelled (Corrected for real DB)
--------------------------------------------------- */

async function getMostCancelledMembershipPlans(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    whereBooking.status = "cancelled";
    whereBooking.bookingType = "paid";

    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);

    const cancelledMemberships = await Booking.findAll({
        where: whereBooking,
        include: [
            studentInclude,
            { model: PaymentPlan, as: "paymentPlan" },
            { model: BookingPayment, as: "payments" }
        ],
        raw: true,
        nest: true
    });

    // then your summarizing logic...
}

function getPeriodRange(period) {
    const now = moment();

    switch (period) {
        case "thisMonth":
            return {
                start: now.startOf("month").toDate(),
                end: now.endOf("month").toDate(),
            };

        case "thisQuarter":
            return {
                start: now.startOf("quarter").toDate(),
                end: now.endOf("quarter").toDate(),
            };

        case "thisYear":
            return {
                start: now.startOf("year").toDate(),
                end: now.endOf("year").toDate(),
            };

        default:
            return null;
    }
}

/* ---------------------------------------------------
   📊 Combined Analytics — summary for dashboard
--------------------------------------------------- */
async function getWeeklyClassPerformance(superAdminId, adminId, filters) {

    const [
        rtc,
        cancelled,
        revenueLost,
        avgTenure,
        reactivated,
        newStudents,
        monthlyAttendance,
        cancellationReasons,
        getByAgeandByGender,
        mostCancelledPlans,
        allVenues,
    ] = await Promise.all([
        getRTCYearComparison(superAdminId, adminId, filters),
        getTotalCancelledYearComparison(superAdminId, adminId, filters),
        getMonthlyRevenueLostComparison(superAdminId, adminId, filters),
        getAvgMembershipTenure(superAdminId, adminId, filters),
        getReactivatedMembership(superAdminId, adminId, filters),
        getTotalNewStudents(superAdminId, adminId, filters),

        getMonthlyCancellations(superAdminId, adminId, filters),
        getCancellationReasons(superAdminId, adminId, filters),
        getCancellStudentByAgeAndByGender(superAdminId, adminId, filters),
        getMostCancelledMembershipPlans(superAdminId, adminId, filters),
        getAllVenuesUsedInCancelled(superAdminId, adminId),
    ])

    return {
        totalRTCs: rtc,
        totalCancelled: cancelled,
        monthlyRevenueLost: revenueLost,
        avgMembershipTenure: avgTenure,
        reactivatedMembership: reactivated,
        totalNewStudents: newStudents,
        graph: monthlyAttendance,
        cancellationReasons: cancellationReasons,
        getByAgeandByGender: getByAgeandByGender,
        mostCancelledPlans: mostCancelledPlans,
        allVenues,
    };
}

module.exports = {
    getWeeklyClassPerformance,
};
