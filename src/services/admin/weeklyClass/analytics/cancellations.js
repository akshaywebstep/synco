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

function getMonthRange(monthOffset = 0) {
    const start = moment().startOf("month").add(monthOffset, "months").toDate();
    const end = moment().endOf("month").add(monthOffset, "months").toDate();
    return { start, end };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pctChange(current, previous) {
    if (previous === 0) {
        return current === 0 ? "0%" : "+100%";
    }
    const change = ((current - previous) / previous) * 100;
    return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

async function calculateMetric(fn, superAdminId, adminId) {
    // this month
    const thisMonth = await fn(superAdminId, adminId, 0);

    // last month
    const lastMonth = await fn(superAdminId, adminId, -1);

    // difference %
    const change = pctChange(thisMonth, lastMonth);

    return { thisMonth, lastMonth, change };
}

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

async function getAllVenuesUsedInCancelled(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    const cancelled = await Booking.findAll({
        where: {
            ...whereBooking,
            status: "cancelled",
        },
        attributes: ["venueId"],
        group: ["venueId"],
        include: [
            {
                model: Venue,
                as: "venue",
                attributes: ["id", "name"]
            }
        ],
        raw: true,
        nest: true
    });

    return cancelled
        .map(c => ({
            id: c.venue?.id,
            name: c.venue?.name
        }))
        .filter(v => v.id);
}

/* ---------------------------------------------------
   🧮 Correct RTC Count — count bookings with status = "request_to_cancel"
--------------------------------------------------- */
async function getTotalRTCs(superAdminId, adminId, filters, monthOffset = 0) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    const { start, end } = getMonthRange(monthOffset);

    whereBooking.status = "request_to_cancel";
    whereBooking.createdAt = { [Op.between]: [start, end] };

    // Apply age filter only
    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);

    return await Booking.count({
        where: whereBooking,
        include: [studentInclude],
        distinct: true,
        col: "id"   // ❗ must NOT be Booking.id
    });

}

/* ---------------------------------------------------
   ❌ 2️⃣ Total Cancellations — from CancelBooking table
--------------------------------------------------- */
async function getTotalCancelled(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    whereBooking.status = "cancelled";

    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);

    // ⭐ FIX: use findAll + group instead of count()
    const rows = await Booking.findAll({
        where: whereBooking,
        include: [studentInclude],
        attributes: ["id"],
        group: ["Booking.id"],
        raw: true
    });

    return rows.length;
}

/* ---------------------------------------------------
   💸 3️⃣ Monthly Revenue Lost — from cancelled bookings
--------------------------------------------------- */
async function getMonthlyRevenueLost(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const startDate = moment().startOf("month").toDate();
    const endDate = moment().endOf("month").toDate();

    // ✅ Get cancelled bookings accessible to this admin/superAdmin
    const bookings = await Booking.findAll({
        where: {
            ...whereBooking,
            status: "cancelled",
            createdAt: { [Op.between]: [startDate, endDate] },
        },
        attributes: ["id", "paymentPlanId"],
        include: [
            {
                model: PaymentPlan,
                as: "paymentPlan",
                attributes: ["price"],
            },
        ],
    });

    // 💰 Calculate total lost revenue
    const totalLost = bookings.reduce((sum, b) => {
        const price = b.paymentPlan?.price || 0;
        return sum + price;
    }, 0);

    return parseFloat(totalLost.toFixed(2));
}

/* ---------------------------------------------------
   🧾 4️⃣ Average Membership Tenure — via PaymentPlan
--------------------------------------------------- */
async function getAvgMembershipTenure(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    whereBooking.paymentPlanId = { [Op.not]: null };

    const bookings = await Booking.findAll({
        where: whereBooking,
        include: [
            {
                model: PaymentPlan,
                as: "paymentPlan",
                attributes: ["duration"], // duration in months
            },
        ],
    });

    const durations = bookings
        .map((b) => b.paymentPlan?.duration || 0)
        .filter((d) => d > 0);

    const avgTenure =
        durations.length > 0
            ? parseFloat(
                (
                    durations.reduce((a, b) => a + b, 0) / durations.length
                ).toFixed(1)
            )
            : 0;

    return avgTenure;
}

/* ---------------------------------------------------
   🧊 5️⃣ Reactivated Memberships — reactivate = true AND status = active
--------------------------------------------------- */
async function getReactivatedMembership(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    const reactivatedCount = await Booking.count({
        where: {
            ...whereBooking,
            reactivate: "true",       // new field
            status: "active",         // active status required
        },
    });

    return reactivatedCount;
}

/* ---------------------------------------------------
   👶 6️⃣ Total New Students — via BookingStudentMeta
--------------------------------------------------- */
async function getTotalNewStudents(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);
    const startDate = moment().startOf("month").toDate();
    const endDate = moment().endOf("month").toDate();

    whereBooking.createdAt = { [Op.between]: [startDate, endDate] };

    const bookings = await Booking.findAll({
        where: whereBooking,
        include: [
            {
                model: BookingStudentMeta,
                as: "students",
                attributes: ["id"],
            },
        ],
    });

    const totalStudents = bookings.reduce(
        (sum, b) => sum + (b.students?.length || 0),
        0
    );

    return totalStudents;
}

async function getMonthlyCancellations(superAdminId, adminId, filters) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    const results = [];

    for (let i = 0; i < 12; i++) {
        const start = moment().month(i).startOf("month").toDate();
        const end = moment().month(i).endOf("month").toDate();

        // Count total cancellations for the month
        const cancelled = await Booking.count({
            where: {
                ...whereBooking,
                status: "cancelled",
                createdAt: { [Op.between]: [start, end] },
            },
        });

        results.push({
            month: MONTHS[i],
            cancelled,
        });
    }

    // ⭐ Current + last month stats
    const currentMonthIndex = moment().month();
    const lastMonthIndex = currentMonthIndex - 1 < 0 ? 0 : currentMonthIndex - 1;

    const thisMonth = results[currentMonthIndex].cancelled;
    const lastMonth = results[lastMonthIndex].cancelled;

    let change = 0;

    if (lastMonth === 0) {
        change = thisMonth > 0 ? 100 : 0;
    } else {
        change = ((thisMonth - lastMonth) / lastMonth) * 100;
    }

    return {
        thisMonth: thisMonth.toString(),
        lastMonth: lastMonth.toString(),
        change: `${change.toFixed(2)}%`,
        monthly: results, // Full Jan–Dec dataset
    };
}

/* ---------------------------------------------------
   ❗ 7️⃣ Cancellation Reasons — Grouped (Count + %)
--------------------------------------------------- */
async function getCancellationReason(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    whereBooking.status = "cancelled";

    const { studentInclude } = await applyGlobalFilters(whereBooking, filters);

    const cancelledBookings = await Booking.findAll({
        where: whereBooking,
        attributes: ["id"],
        include: [studentInclude],
        raw: true,
    });

    if (!cancelledBookings.length) {
        return { total: 0, reasons: [] };
    }

    const bookingIds = cancelledBookings.map(b => b.id);

    const cancelEntries = await CancelBooking.findAll({
        where: { bookingId: { [Op.in]: bookingIds } },
        attributes: ["cancelReason"],
        raw: true,
    });

    const total = cancelEntries.length;

    const reasonCounts = {};
    cancelEntries.forEach(e => {
        const r = e.cancelReason || "Unknown";
        reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    });

    const reasons = Object.keys(reasonCounts).map(r => ({
        reason: r,
        count: reasonCounts[r],
        percentage: parseFloat(((reasonCounts[r] / total) * 100).toFixed(2))
    }));

    return { total, reasons };
}

/* ---------------------------------------------------
   👶 8️⃣ Cancelled Students — By Age & By Gender
--------------------------------------------------- */
async function getCancellStudentByAgeAndByGender(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId, filters);

    // 1️⃣ Fetch all cancelled bookings
    const cancelledBookings = await Booking.findAll({
        where: {
            ...whereBooking,
            status: "cancelled",
            ...(filters.startDate && filters.endDate
                ? { createdAt: { [Op.between]: [filters.startDate, filters.endDate] } }
                : {})
        },
        attributes: ["id"],
        raw: true,
    });

    if (cancelledBookings.length === 0) {
        return { byAge: [], byGender: [] };
    }

    const bookingIds = cancelledBookings.map(b => b.id);

    // 2️⃣ Fetch all student meta for cancelled bookings
    const students = await BookingStudentMeta.findAll({
        where: { bookingTrialId: { [Op.in]: bookingIds } },
        attributes: ["age", "gender"],
        raw: true,
    });

    if (students.length === 0) {
        return { byAge: [], byGender: [] };
    }

    const total = students.length;

    // 3️⃣ Group by Age
    const ageCounts = {};
    students.forEach(s => {
        const age = s.age ? s.age.toString() : "Unknown";
        if (!ageCounts[age]) ageCounts[age] = 0;
        ageCounts[age]++;
    });

    const byAge = Object.keys(ageCounts).map(age => ({
        age,
        count: ageCounts[age],
        percentage: parseFloat(((ageCounts[age] / total) * 100).toFixed(2)),
    }));

    byAge.sort((a, b) => b.count - a.count); // biggest first

    // 4️⃣ Group by Gender
    const genderCounts = {};
    students.forEach(s => {
        const gender = s.gender || "Unknown";
        if (!genderCounts[gender]) genderCounts[gender] = 0;
        genderCounts[gender]++;
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

function getAgeFilter(age) {
    if (!age || age === "allAges") return null;

    if (age === "under18") {
        return { age: { [Op.lt]: 18 } };
    }

    if (age === "18-25") {
        return { age: { [Op.between]: [18, 25] } };
    }

    return null;
}
async function applyGlobalFilters(whereBooking, filters) {
    // PERIOD FILTER
    if (filters.period) {
        const range = getPeriodRange(filters.period);
        if (range) {
            whereBooking.createdAt = { [Op.between]: [range.start, range.end] };
        }
    }

    // AGE FILTER (joins BookingStudentMeta)
    const ageFilter = getAgeFilter(filters.age);

    const studentInclude = {
        model: BookingStudentMeta,
        as: "students",
        attributes: [],
        where: ageFilter || undefined,
        required: !!ageFilter,
    };

    return { studentInclude };
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
        calculateMetric((s, a, offset) => getTotalRTCs(s, a, filters, offset), superAdminId, adminId),
        calculateMetric((s, a, offset) => getTotalCancelled(s, a, filters, offset), superAdminId, adminId),
        calculateMetric((s, a, offset) => getMonthlyRevenueLost(s, a, filters, offset), superAdminId, adminId),
        calculateMetric((s, a, offset) => getAvgMembershipTenure(s, a, filters, offset), superAdminId, adminId),
        calculateMetric((s, a, offset) => getReactivatedMembership(s, a, filters, offset), superAdminId, adminId),
        calculateMetric((s, a, offset) => getTotalNewStudents(s, a, filters, offset), superAdminId, adminId),

        getMonthlyCancellations(superAdminId, adminId, filters),
        getCancellationReason(superAdminId, adminId, filters),
        getCancellStudentByAgeAndByGender(superAdminId, adminId, filters),
        getMostCancelledMembershipPlans(superAdminId, adminId, filters),
        getAllVenuesUsedInCancelled(superAdminId, adminId, filters),
    ])

    return {
        totalRTCs: rtc,
        totalCancelled: cancelled,
        monthlyRevenueLost: revenueLost,
        avgMembershipTenure: avgTenure,
        reactivatedMembership: reactivated,
        totalNewStudents: newStudents,
        chart: monthlyAttendance,
        cancellationReasons: cancellationReasons,
        getByAgeandByGender: getByAgeandByGender,
        mostCancelledPlans: mostCancelledPlans,
        allVenues,
    };
}

module.exports = {
    getWeeklyClassPerformance,
};
