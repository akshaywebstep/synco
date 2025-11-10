const { Op } = require("sequelize");
const moment = require("moment");
const {
    Booking,
    BookingStudentMeta,
    ClassSchedule,
    Venue,
    CancelBooking,
    PaymentPlan,
    Admin,
} = require("../../../../models");

// 🧩 Utility: build where conditions based on admin hierarchy
async function buildAccessConditions(superAdminId, adminId) {
    const whereLead = {};
    const whereVenue = {};
    const whereSchedule = {};
    const whereBooking = {};

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
   🧮 1️⃣ Total RTCs — total bookings with status = "rtc"
--------------------------------------------------- */
async function getTotalRTCs(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId);

    // ✅ Only include bookings that are marked as "rtc"
    whereBooking.status = "cancelled";

    // ✅ Find all booking IDs accessible to this admin/superAdmin
    const bookings = await Booking.findAll({
        where: whereBooking,
        attributes: ["id"], // only fetch IDs
        raw: true,
    });

    const bookingIds = bookings.map((b) => b.id);
    if (bookingIds.length === 0) return 0;

    // ✅ Count all CancelBooking records linked to these RTC bookings
    const rtcCount = await CancelBooking.count({
        where: { bookingId: { [Op.in]: bookingIds } },
    });

    return rtcCount;
}

/* ---------------------------------------------------
   ❌ 2️⃣ Total Cancellations — from CancelBooking table
--------------------------------------------------- */
async function getTotalCancelled(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId);

    // ✅ Only include bookings that are cancelled
    whereBooking.status = "cancelled";

    // ✅ Find all booking IDs accessible to this admin/superAdmin
    const bookings = await Booking.findAll({
        where: whereBooking,
        attributes: ["id"], // only fetch IDs
        raw: true,
    });

    const bookingIds = bookings.map((b) => b.id);
    if (bookingIds.length === 0) return 0;

    // ✅ Count all CancelBooking records linked to these bookings
    const cancelledCount = await CancelBooking.count({
        where: { bookingId: { [Op.in]: bookingIds } },
    });

    return cancelledCount;
}

/* ---------------------------------------------------
   💸 3️⃣ Monthly Revenue Lost — from cancelled bookings
--------------------------------------------------- */
async function getMonthlyRevenueLost(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId);
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
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId);
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
   🧊 5️⃣ Reactivated Memberships — status = "froze"
--------------------------------------------------- */
async function getReactivatedMembership(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId);

    const reactivatedCount = await Booking.count({
        where: {
            ...whereBooking,
            status: "froze",
        },
    });

    return reactivatedCount;
}

/* ---------------------------------------------------
   👶 6️⃣ Total New Students — via BookingStudentMeta
--------------------------------------------------- */
async function getTotalNewStudents(superAdminId, adminId, filters = {}) {
    const { whereBooking } = await buildAccessConditions(superAdminId, adminId);
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

/* ---------------------------------------------------
   📊 Combined Analytics — summary for dashboard
--------------------------------------------------- */
async function getWeeklyClassPerformance(superAdminId, adminId, filters = {}) {
    const [
        totalRTCs,
        totalCancelled,
        monthlyRevenueLost,
        avgMembershipTenure,
        reactivatedMembership,
        totalNewStudents,
    ] = await Promise.all([
        getTotalRTCs(superAdminId, adminId, filters),
        getTotalCancelled(superAdminId, adminId, filters),
        getMonthlyRevenueLost(superAdminId, adminId, filters),
        getAvgMembershipTenure(superAdminId, adminId, filters),
        getReactivatedMembership(superAdminId, adminId, filters),
        getTotalNewStudents(superAdminId, adminId, filters),
    ]);

    return {
        totalRTCs,
        totalCancelled,
        monthlyRevenueLost,
        avgMembershipTenure,
        reactivatedMembership,
        totalNewStudents,
    };
}

module.exports = {
    getWeeklyClassPerformance,
};
