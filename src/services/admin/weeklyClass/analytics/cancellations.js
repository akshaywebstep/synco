const { Op, Sequelize } = require("sequelize");
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

// 🧮 1️⃣ Total RTCs (count total "RTC" bookings)
async function getTotalRTCs(superAdminId, filters = {}) {
  const whereCondition = { status: "rtc" }; // assuming "rtc" is stored in booking.status
  if (filters.bookedBy) whereCondition.bookedBy = filters.bookedBy;

  const count = await Booking.count({ where: whereCondition });
  return count;
}

// ❌ 2️⃣ Total Cancellations (from CancelBooking table)
async function getTotalCancelled(superAdminId, filters = {}) {
  const whereCondition = {};
  if (filters.bookedBy) whereCondition.bookedBy = filters.bookedBy;

  const cancelled = await CancelBooking.count({ where: whereCondition });
  return cancelled;
}

// 💸 3️⃣ Monthly Revenue Lost (estimate: revenue from cancelled bookings)
async function getMonthlyRevenueLost(superAdminId, filters = {}) {
  // This assumes your Booking table has `amount` or `price` field
  // and CancelBooking references that booking via `bookingTrialId`
  const startDate = moment().startOf("month").toDate();
  const endDate = moment().endOf("month").toDate();

  const cancelledBookings = await CancelBooking.findAll({
    include: [
      {
        model: Booking,
        as: "booking",
        attributes: ["price", "bookedBy", "createdAt"],
        where: {
          createdAt: { [Op.between]: [startDate, endDate] },
          ...(filters.bookedBy && { bookedBy: filters.bookedBy }),
        },
      },
    ],
  });

  const totalLost = cancelledBookings.reduce(
    (sum, c) => sum + (c.booking?.price || 0),
    0
  );

  return totalLost;
}

// 🧾 4️⃣ Average Membership Tenure (based on PaymentPlan duration)
async function getAvgMembershipTenure(superAdminId, filters = {}) {
  const bookings = await Booking.findAll({
    where: {
      ...(filters.bookedBy && { bookedBy: filters.bookedBy }),
      paymentPlanId: { [Op.not]: null },
    },
    include: [
      {
        model: PaymentPlan,
        as: "paymentPlan",
        attributes: ["duration"], // assuming duration in months
      },
    ],
  });

  const durations = bookings
    .map((b) => b.paymentPlan?.duration || 0)
    .filter((d) => d > 0);

  const avgTenure =
    durations.length > 0
      ? parseFloat((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1))
      : 0;

  return avgTenure;
}

// 🧊 5️⃣ Reactivated Memberships (bookings with status = "froze")
async function getReactivatedMembership(superAdminId, filters = {}) {
  const whereCondition = { status: "froze" };
  if (filters.bookedBy) whereCondition.bookedBy = filters.bookedBy;

  const reactivatedCount = await Booking.count({ where: whereCondition });
  return reactivatedCount;
}

// 👶 6️⃣ Total New Students (linked via BookingStudentMeta)
async function getTotalNewStudents(superAdminId, filters = {}) {
  const startDate = moment().startOf("month").toDate();
  const endDate = moment().endOf("month").toDate();

  const bookings = await Booking.findAll({
    where: {
      createdAt: { [Op.between]: [startDate, endDate] },
      ...(filters.bookedBy && { bookedBy: filters.bookedBy }),
    },
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

// 📊 Combined analytics
async function getWeeklyClassPerformance(superAdminId, filters = {}) {
  const [
    totalRTCs,
    totalCancelled,
    monthlyRevenueLost,
    avgMembershipTenure,
    reactivatedMembership,
    totalNewStudents,
  ] = await Promise.all([
    getTotalRTCs(superAdminId, filters),
    getTotalCancelled(superAdminId, filters),
    getMonthlyRevenueLost(superAdminId, filters),
    getAvgMembershipTenure(superAdminId, filters),
    getReactivatedMembership(superAdminId, filters),
    getTotalNewStudents(superAdminId, filters),
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
