// services/admin/monthlyClass.js
const { Op } = require("sequelize");
const moment = require("moment");

const {
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  Venue,
  Lead,
  BookingPayment,
  PaymentPlan,
  Admin,
} = require("../../../../models");

const usedVenues = new Map();
// Helper functions
function totalRevenueSum(bookings) {
  return bookings.reduce((sum, b) => {
    if (
      b.paymentPlan &&
      typeof b.paymentPlan.price === "number" &&
      Array.isArray(b.students)
    ) {
      const totalStudents = b.students.length;
      sum += b.paymentPlan.price * totalStudents;
    }
    return sum;
  }, 0);
}

function totalCancellations(bookings) {
  return bookings.filter((b) => b.status === "cancelled").length;
}

function getNewStudents(bookings) {
  const current = moment();

  return bookings
    .flatMap((booking) => booking.students || []) // flatten all students into a single array
    .filter((student) => {
      const studentCreatedAt = moment(student.createdAt);
      return (
        studentCreatedAt.month() === current.month() &&
        studentCreatedAt.year() === current.year()
      );
    });
}

function getNewStudents(bookings) {
  const current = moment();
  const newStudents = [];

  bookings.forEach((booking) => {
    if (booking.students && Array.isArray(booking.students)) {
      booking.students.forEach((student) => {
        const studentCreatedAt = moment(student.createdAt);
        if (
          studentCreatedAt.month() === current.month() &&
          studentCreatedAt.year() === current.year()
        ) {
          newStudents.push(student);
        }
      });
    }
  });

  return newStudents;
}

function countTrialToMember(bookings) {
  return bookings.reduce((sum, b) => {
    if (
      ((b.type === "free" || b.trialDate !== null) &&
        (b.paymentPlanId !== null || b.startDate !== null)) ||
      (b.trialDate !== null && b.startDate !== null)
    ) {
      return sum + 1; // count this booking
    }
    return sum;
  }, 0);
}

const countRebook = (bookings) =>
  bookings.reduce((sum, b) => sum + (b.status === "rebooked" ? 1 : 0), 0);

function calcPercentageDiff(currentStats, lastStats, isYear = false) {
  const current = currentStats?.freeTrialsCount ?? 0;

  let last = 0;
  if (lastStats) {
    // Unwrap lastStats if it’s already a diff object
    last =
      lastStats.currentMonthStats?.freeTrialsCount ??
      lastStats?.freeTrialsCount ??
      0;
  }

  if (last === 0 && current === 0) {
    return {
      percent: 0,
      color: "gray",
      message: "No change",
      ...(isYear
        ? { currentYearStats: currentStats, lastYearStats: lastStats }
        : { currentMonthStats: currentStats, lastMonthStats: lastStats }),
    };
  }

  const diff = ((current - last) / last) * 100;
  return {
    percent: Math.abs(diff.toFixed(2)),
    color: diff >= 0 ? "green" : "red",
    message:
      diff >= 0
        ? `Increased by ${Math.abs(diff.toFixed(2))}%`
        : `Decreased by ${Math.abs(diff.toFixed(2))}%`,
    ...(isYear
      ? { currentYearStats: currentStats, lastYearStats: lastStats }
      : { currentMonthStats: currentStats, lastMonthStats: lastStats }),
  };
}

// Group bookings by Year → Month
function groupBookingsByYearMonth(bookings, filter) {
  if (!bookings || bookings.length === 0) return {};

  bookings.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const startDate = moment(bookings[0].createdAt).startOf("month");
  const endDate = moment(bookings[bookings.length - 1].createdAt).endOf(
    "month"
  );

  const grouped = {};
  let current = startDate.clone();

  while (current.isSameOrBefore(endDate, "month")) {
    const yearKey = current.format("YYYY");
    const monthKey = current.format("MM");

    const monthBookings = bookings.filter((b) =>
      moment(b.createdAt).isBetween(
        current.clone().startOf("month"),
        current.clone().endOf("month"),
        null,
        "[]"
      )
    );

    const newStudents = getNewStudents(monthBookings).length;
    const totalRevenue = totalRevenueSum(monthBookings);
    const totalCancellation = totalCancellations(monthBookings);

    // Avoid division by zero
    const averageMonthlyFee = newStudents > 0 ? totalRevenue / newStudents : 0;

    const saleTrend = {
      newStudents,
      totalRevenue,
      averageMonthlyFee,
      totalCancellation,
    };

    const agents = [];
    const filteredBookings = [];
    const enrolledStudents = { byAge: {}, byGender: {} };
    const paymentPlansTrend = [];

    const marketingChannelPerformance = {
      referall: 0,
      facebook: 0,
      others: 0,
    };

    monthBookings.forEach((b) => {
      filteredBookings.push(b);
      const status = b?.lead?.status?.toLowerCase();
      if (status) {
        if (status === "referall" || status === "referral") {
          marketingChannelPerformance.referall++;
        } else if (status === "facebook") {
          marketingChannelPerformance.facebook++;
        } else {
          marketingChannelPerformance.others++;
        }
      }

      // Students
      b.students.forEach((s) => {
        if (s.dateOfBirth) {
          const age = moment().diff(moment(s.dateOfBirth), "years");
          enrolledStudents.byAge[age] = (enrolledStudents.byAge[age] || 0) + 1;
        }

        const gender = (s.gender || "other").toLowerCase();
        enrolledStudents.byGender[gender] =
          (enrolledStudents.byGender[gender] || 0) + 1;
      });

      // Agents
      const admin = b.bookedByAdmin;
      if (!admin) return;
      const price = Number(b.paymentPlan?.price || 0);
      if (!agents[admin.id])
        agents[admin.id] = {
          id: admin.id,
          name: `${admin.firstName} ${admin.lastName}`,
          saleTrend: {
            newStudents: 0,
            totalRevenue: 0,
            averageMonthlyFee: 0,
            totalCancellation: 0,
          },
        };

      if (b.students && Array.isArray(b.students)) {
        const newStudentsCount = b.students.filter((student) => {
          const studentCreatedAt = moment(student.createdAt);
          return (
            studentCreatedAt.month() === current.month() &&
            studentCreatedAt.year() === current.year()
          );
        }).length;

        agents[admin.id].saleTrend.newStudents += newStudentsCount;
      }

      agents[admin.id].saleTrend.totalRevenue +=
        price * agents[admin.id].saleTrend.newStudents;
      agents[admin.id].saleTrend.averageMonthlyFee =
        agents[admin.id].saleTrend.newStudents > 0
          ? agents[admin.id].saleTrend.totalRevenue /
          agents[admin.id].saleTrend.newStudents
          : 0;

      if (b.status === "cancelled") {
        agents[admin.id].saleTrend.totalCancellation += 1;
      }

      // Collect venue if it exists
      const venue = b.classSchedule?.venue;
      if (venue && venue.id) {
        usedVenues.set(venue.id, { id: venue.id, name: venue.name });
      }
    });

    const agentSummary = Object.values(agents).sort(
      (a, b) => b.saleTrend.totalRevenue - a.saleTrend.totalRevenue
    );

    if (!grouped[yearKey]) grouped[yearKey] = { monthlyGrouped: {} };

    grouped[yearKey].monthlyGrouped[monthKey] = {
      bookings: filteredBookings,
      saleTrend,
      agentSummary,
      enrolledStudents,
      paymentPlansTrend,
      marketingChannelPerformance,
    };

    current.add(1, "month");
  }

  // Month-over-month trends
  Object.keys(grouped).forEach((yearKey) => {
    const months = Object.keys(grouped[yearKey].monthlyGrouped).sort();
    months.forEach((monthKey, i) => {
      const monthData = grouped[yearKey].monthlyGrouped[monthKey];
      if (i === 0) {
        monthData.saleTrend = calcPercentageDiff(monthData.saleTrend, null);
        monthData.agentSummary = monthData.agentSummary.map((agent) => {
          const { saleTrend, ...rest } = agent;
          return { ...rest, saleTrend: calcPercentageDiff(saleTrend, null) };
        });
      } else {
        const lastMonthKey = months[i - 1];
        const lastMonthData = grouped[yearKey].monthlyGrouped[lastMonthKey];

        monthData.saleTrend = calcPercentageDiff(
          monthData.saleTrend,
          lastMonthData.saleTrend
        );
        monthData.agentSummary = monthData.agentSummary.map((agent) => {
          const prev = lastMonthData.agentSummary.find(
            (a) => a.id === agent.id
          );
          const { saleTrend, ...rest } = agent;
          return {
            ...rest,
            saleTrend: calcPercentageDiff(
              agent.saleTrend,
              prev ? prev.saleTrend : null
            ),
          };
        });
      }
    });

    // Yearly saleTrend
    const yearTotal = {
      newStudents: 0,
      totalRevenue: 0,
      averageMonthlyFee: 0,
      totalCancellation: 0,
    };
    const lastYearTotal =
      grouped[String(Number(yearKey) - 1)]?.yearlyTotal || null;
    const yearlyMarketingPerformance = {};

    Object.values(grouped[yearKey].monthlyGrouped).forEach((m) => {
      const monthStats = m.saleTrend.currentMonthStats;

      // ✅ Aggregate numeric stats
      yearTotal.newStudents += monthStats.newStudents;
      yearTotal.totalRevenue += monthStats.totalRevenue;
      yearTotal.averageMonthlyFee += monthStats.averageMonthlyFee;
      yearTotal.totalCancellation += monthStats.totalCancellation;

      // ✅ Combine marketing channel performance across months
      const monthlyMarketing = m.marketingChannelPerformance || {};
      Object.entries(monthlyMarketing).forEach(([channel, count]) => {
        yearlyMarketingPerformance[channel] =
          (yearlyMarketingPerformance[channel] || 0) + count;
      });
    });

    grouped[yearKey].marketingChannelPerformance = yearlyMarketingPerformance;

    yearTotal.averageMonthlyFee =
      yearTotal.newStudents > 0
        ? yearTotal.totalRevenue / yearTotal.newStudents
        : 0;

    // ✅ Compute percentage difference
    grouped[yearKey].saleTrend = calcPercentageDiff(
      yearTotal,
      lastYearTotal,
      true
    );
  });

  return grouped;
}

// Main Report
const getMonthlyReport = async (filters) => {
  try {
    const { adminId, superAdminId } = filters; // ✅ Both passed from controller

    const whereBooking = {
      [Op.and]: [
        { bookingType: "paid" },
        { status: "active" }
      ]
    };

    const whereVenue = {};
    const whereSchedule = {};
    // const whereLead = {};

    // ✅ Access Control Logic
    if (superAdminId && superAdminId === adminId) {
      // ✅ Super Admin — include leads/venues/schedules created by self or managed admins
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId); // include self

      whereVenue.createdBy = { [Op.in]: adminIds };
      whereSchedule.createdBy = { [Op.in]: adminIds };
      whereBooking.bookedBy = { [Op.in]: adminIds };
    } else {
      // ✅ Normal Admin — include own + super admin’s records
      // whereLead.createdBy = { [Op.in]: [adminId, superAdminId] };
      whereVenue.createdBy = { [Op.in]: [adminId, superAdminId] };
      whereSchedule.createdBy = { [Op.in]: [adminId, superAdminId] };
      whereBooking.bookedBy = { [Op.in]: [adminId, superAdminId] };
    }

    // ✅ Query with relational filters
    const bookings = await Booking.findAll({
      order: [["id", "DESC"]],
      where: whereBooking,
      include: [
        {
          model: Venue,
          as: "venue",
          required: false,
          where: whereVenue,
        },
        {
          model: Lead,
          as: "lead",
          required: false
        },

        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          where: whereSchedule,
          include: [
            { model: Venue, as: "venue", required: false, where: whereVenue },
          ],
        },
        { model: BookingPayment, as: "payments", required: false },
        { model: PaymentPlan, as: "paymentPlan", required: false },
        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
            "profile",
          ],
          required: false,
        },
      ],
    });

    // ✅ Group and summarize results
    const filteredBookings = bookings.filter(b => {
      let valid = true;

      // Student name filter
      if (valid && filters.student?.name?.trim()) {
        const search = filters.student.name.trim().toLowerCase();
        valid =
          b.students?.some(
            s =>
              (s.studentFirstName || "").toLowerCase().includes(search) ||
              (s.studentLastName || "").toLowerCase().includes(search)
          ) || false;
      }

      // Venue filter
      if (valid && filters.venue?.name?.trim()) {
        const search = filters.venue.name.trim().toLowerCase();
        valid = (b.classSchedule?.venue?.name || "").toLowerCase() === search;
      }

      // Payment plan filter
      if (
        valid &&
        filters.paymentPlan.interval &&
        filters.paymentPlan.duration > 0
      ) {
        const interval = (b.paymentPlan?.interval || "").toLowerCase();
        const duration = Number(b.paymentPlan?.duration || 0);
        valid =
          interval === filters.paymentPlan.interval.trim().toLowerCase() &&
          duration === Number(filters.paymentPlan.duration);
      }

      // Admin filter
      if (valid && filters.admin?.name?.trim()) {
        const search = filters.admin.name.trim().toLowerCase();
        const firstName = (b.bookedByAdmin?.firstName || "").toLowerCase();
        const lastName = (b.bookedByAdmin?.lastName || "").toLowerCase();
        valid = firstName.includes(search) || lastName.includes(search);
      }

      // Age filter
      if (filters.age) {
        if (filters.age === "under18") {
          valid = b.students?.some(s => Number(s.age) < 18);
        } else if (filters.age === "18-25") {
          valid = b.students?.some(s => Number(s.age) >= 18 && Number(s.age) <= 25);
        } else if (filters.age === "allAges") {
          valid = true;
        }
      }

      // Period filter
      if (valid && filters.period) {
        const now = moment();
        if (filters.period === "thisMonth") {
          valid = moment(b.createdAt).isSame(now, "month");
        } else if (filters.period === "thisQuarter") {
          valid = moment(b.createdAt).quarter() === now.quarter();
        } else if (filters.period === "thisYear") {
          valid = moment(b.createdAt).isSame(now, "year");
        }
      }

      return valid;
    });
    const yealyGrouped = groupBookingsByYearMonth(filteredBookings, filters, usedVenues);

    const overallTrends = {
      newStudents: 0,
      totalRevenue: 0,
      averageMonthlyFee: 0,
      totalCancellation: 0,
    };

    Object.values(yealyGrouped).forEach((year) => {
      Object.values(year.monthlyGrouped).forEach((month) => {
        const s = month.saleTrend.currentMonthStats;
        overallTrends.newStudents += s.newStudents;
        overallTrends.totalRevenue += s.totalRevenue;
        overallTrends.averageMonthlyFee += s.averageMonthlyFee;
        overallTrends.totalCancellation += s.totalCancellation;
      });
    });

    overallTrends.averageMonthlyFee =
      overallTrends.newStudents > 0
        ? overallTrends.totalRevenue / overallTrends.newStudents
        : 0;

    return {
      status: true,
      message: "Monthly class report generated successfully.",
      data: { yealyGrouped, overallTrends, allVenues: Array.from(usedVenues.values()) },
    };
  } catch (error) {
    console.error("❌ Sequelize Error:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error occurred while generating monthly class report.",
    };
  }
};

module.exports = { getMonthlyReport };
