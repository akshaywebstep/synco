
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
function countFreeTrials(bookings) {
  return bookings.reduce((sum, b) => {
    // Check if trialDate is not null and type is 'free'
    if (b.trialDate !== null || b.type === "free") {
      return sum + 1; // or sum + b.amount if you want to sum a value
    }
    return sum;
  }, 0);
}

const calculateMonthlyRevenue = (bookings) => {
  return bookings
    .filter((b) => b.isConvertedToMembership === true && b.paymentPlan)
    .reduce((total, b) => total + (b.paymentPlan.price || 0), 0);
};

function countAttendedTrials(bookings) {
  return bookings.reduce((sum, b) => {
    if (b.students && Array.isArray(b.students)) {
      // Count students with attendance === 'attended'
      const attendedCount = b.students.filter(
        (student) => student.attendance === "attended"
      ).length;
      return sum + attendedCount;
    }
    return sum;
  }, 0);
}

function countTrialToMember(bookings) {
  return bookings.reduce((sum, b) => {
    if (
      b.isConvertedToMembership === true ||
      b.isConvertedToMembership === 1 ||
      b.isConvertedToMembership === "1"
    ) {
      return sum + 1;
    }
    return sum;
  }, 0);
}

const countRebook = (bookings) =>
  bookings.reduce((sum, b) => sum + (b.status === "rebooked" ? 1 : 0), 0);

function calcPercentageDiff(currentStats, lastStats, isYear = false) {
  const current = currentStats?.freeTrialsCount ?? 0;
  const last = lastStats?.freeTrialsCount ?? 0;

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

  const diff = last === 0 ? 100 : ((current - last) / last) * 100;

  return {
    percent: Number(Math.abs(diff).toFixed(2)),
    color: diff >= 0 ? "green" : "red",
    message:
      diff >= 0
        ? `Increased by ${Math.abs(diff).toFixed(2)}%`
        : `Decreased by ${Math.abs(diff).toFixed(2)}%`,
    ...(isYear
      ? { currentYearStats: currentStats, lastYearStats: lastStats }
      : { currentMonthStats: currentStats, lastMonthStats: lastStats }),
  };
}

function facebookPerformance(bookings) {
  if (!bookings || bookings.length === 0) {
    return {
      leadsGenerated: 0,
      trialsBooked: 0,
      trialsAttended: 0,
      membershipsSold: 0,
      conversionRate: 0,
    };
  }

  const fb = bookings.filter(
    (b) => b.lead?.status?.toLowerCase() === "facebook"
  );

  const leadsGenerated = fb.length;

  const trialsBooked = fb.filter(
    (b) => b.type === "free" || b.trialDate !== null
  ).length;

  const trialsAttended = fb.reduce((sum, b) => {
    if (!b.students) return sum;
    return sum + b.students.filter((s) => s.attendance === "attended").length;
  }, 0);

  // Memberships sold (booking.status === "active")
  const membershipsSold = fb.filter(
    (b) => b.status?.toLowerCase() === "active"
  ).length;

  const conversionRate =
    leadsGenerated > 0
      ? Number(((membershipsSold / leadsGenerated) * 100).toFixed(2))
      : 0;

  return {
    leadsGenerated,
    trialsBooked,
    trialsAttended,
    membershipsSold,
    conversionRate,
  };
}

function calcFacebookDiff(current, last, isYear = false) {
  // Handles missing or empty
  if (!current)
    current = {
      leadsGenerated: 0,
      trialsBooked: 0,
      trialsAttended: 0,
      membershipsSold: 0,
      conversionRate: 0,
    };
  if (!last)
    last = {
      leadsGenerated: 0,
      trialsBooked: 0,
      trialsAttended: 0,
      membershipsSold: 0,
      conversionRate: 0,
    };

  const currentTotal = current.leadsGenerated ?? 0;
  const lastTotal = last.leadsGenerated ?? 0;

  if (currentTotal === 0 && lastTotal === 0) {
    return {
      percent: 0,
      color: "gray",
      message: "No change",
      ...(isYear
        ? { currentYearStats: current, lastYearStats: last }
        : { currentMonthStats: current, lastMonthStats: last }),
    };
  }

  const diff = ((currentTotal - lastTotal) / (lastTotal || 1)) * 100;

  return {
    percent: Math.abs(diff.toFixed(2)),
    color: diff >= 0 ? "green" : "red",
    message:
      diff >= 0
        ? `Increased by ${Math.abs(diff.toFixed(2))}%`
        : `Decreased by ${Math.abs(diff.toFixed(2))}%`,
    ...(isYear
      ? { currentYearStats: current, lastYearStats: last }
      : { currentMonthStats: current, lastMonthStats: last }),
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

    const freeTrialsCount = countFreeTrials(monthBookings);
    const attendedCount = countAttendedTrials(monthBookings);

    const attendanceRate =
      freeTrialsCount > 0
        ? Number(((attendedCount / freeTrialsCount) * 100).toFixed(2))
        : 0;

    const trialToMemberCount = countTrialToMember(monthBookings);

    const conversionRate =
      freeTrialsCount > 0
        ? Number(((trialToMemberCount / freeTrialsCount) * 100).toFixed(2))
        : 0;

    const rebookCount = countRebook(monthBookings);

    const freeTrialTrend = {
      freeTrialsCount,
      attendedCount,
      attendanceRate,
      trialToMemberCount,
      conversionRate,
      rebookCount,
    };

    const agents = [];
    const filteredBookings = [];
    const enrolledStudents = { byAge: {}, byGender: {}, byVenue: [] };
    const paymentPlansTrend = [];

    const marketingChannelPerformance = {};

    monthBookings.forEach((b) => {
      if (b.venue) {
        const venueId = b.venue.id;

        // Check if this venue already exists in byVenue
        let venueEntry = enrolledStudents.byVenue.find((v) => v.id === venueId);

        if (!venueEntry) {
          // If not found, create a new entry
          venueEntry = {
            id: b.venue.id,
            name: b.venue.name || null,
            facility: b.venue.facility || null,
            area: b.venue.area || null,
            address: b.venue.address || null,
            freeTrialsCount: 0,
            studentsCount: 0,
          };
          enrolledStudents.byVenue.push(venueEntry);
        }

        // Increment counts for this venue
        venueEntry.freeTrialsCount += 1;
        venueEntry.studentsCount += b.students ? b.students.length : 0;
      }

      if (b.lead && b.lead.status) {
        // If the lead status already exists, increment by 1
        if (marketingChannelPerformance[b.lead.status]) {
          marketingChannelPerformance[b.lead.status] += 1;
        } else {
          // Otherwise, initialize with 1
          marketingChannelPerformance[b.lead.status] = 1;
        }
      }

      if (b.paymentPlan) {
        // Check if this paymentPlan.id already exists in paymentPlansTrend
        const existingPlan = paymentPlansTrend.find(
          (p) => p.id === b.paymentPlan.id
        );

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
            students: b.students?.length || 0,
          });
        } else {
          // Update existing plan's students count
          existingPlan.students += b.students?.length || 0;
        }
      }

      let valid = true;
      // Student filter
      if (filter.student?.name?.trim()) {
        const search = filter.student.name.trim().toLowerCase();
        valid =
          b.students?.some(
            (s) =>
              (s.studentFirstName || "").toLowerCase().includes(search) ||
              (s.studentLastName || "").toLowerCase().includes(search)
          ) || false;
      }

      // Venue filter
      if (valid && filter.venue?.name?.trim()) {
        const search = filter.venue.name.trim().toLowerCase();
        valid = (b.classSchedule?.venue?.name || "").toLowerCase() === search;
      }

      // Venue ID filter
      if (valid && filter.venueId) {
        valid = Number(b.classSchedule?.venue?.id) === Number(filter.venueId);
      }

      // PaymentPlan filter
      if (
        valid &&
        filter.paymentPlan?.interval?.trim() &&
        filter.paymentPlan.duration > 0
      ) {
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
      b.students.forEach((s) => {
        if (s.dateOfBirth) {
          const age = moment().diff(moment(s.dateOfBirth), "years");
          enrolledStudents.byAge[age] = (enrolledStudents.byAge[age] || 0) + 1;
        }

        const gender = (s.gender || "other").toLowerCase();
        enrolledStudents.byGender[gender] =
          (enrolledStudents.byGender[gender] || 0) + 1;
      });

      // Age filter
      if (valid && filter.age) {
        if (filter.age === "under18") {
          valid = b.students?.some((s) => Number(s.age) < 18);
        } else if (filter.age === "18-25") {
          valid = b.students?.some(
            (s) => Number(s.age) >= 18 && Number(s.age) <= 25
          );
        } else if (filter.age === "allAges") {
          valid = true;
        }
      }

      // Period filter
      if (valid && filter.period) {
        const now = moment();
        if (filter.period === "thisMonth") {
          valid = moment(b.createdAt).isSame(now, "month");
        } else if (filter.period === "thisQuarter") {
          valid = moment(b.createdAt).quarter() === now.quarter();
        } else if (filter.period === "thisYear") {
          valid = moment(b.createdAt).isSame(now, "year");
        }
      }

      // if (valid) filteredBookings.push(b);

      // Collect venue if it exists
      const venue = b.classSchedule?.venue;
      if (venue && venue.id) {
        usedVenues.set(venue.id, { id: venue.id, name: venue.name });
      }

      // Agents
      const admin = b.bookedByAdmin;
      if (!admin) return;

      // if (!agents[admin.id]) agents[admin.id] = { id: admin.id, name: `${admin.firstName} ${admin.lastName}`, freeTrialTrend: { freeTrialsCount: 0, attendedCount: 0, attendanceRate: 0, trialToMemberCount: 0, conversionRate: 0, rebookCount: 0 } };
      if (!agents[admin.id]) {
        agents[admin.id] = {
          id: admin.id,
          name: `${admin.firstName} ${admin.lastName}`,
          email: admin.email || null,
          roleId: admin.roleId || null,
          status: admin.status || null,
          profile: admin.profile || null, // ✅ Add profile here
          freeTrialTrend: {
            freeTrialsCount: 0,
            attendedCount: 0,
            attendanceRate: 0,
            trialToMemberCount: 0,
            conversionRate: 0,
            rebookCount: 0,
          },
        };
      }

      if (b.trialDate !== null || b.type === "free") {
        agents[admin.id].freeTrialTrend.freeTrialsCount += 1;
      }

      if (b.students && Array.isArray(b.students)) {
        // Count students with attendance === 'attended'
        agents[admin.id].freeTrialTrend.attendedCount += b.students.filter(
          (student) => student.attendance === "attended"
        ).length;
      }

      // agents[admin.id].freeTrialTrend.attendanceRate = agents[admin.id].freeTrialTrend.freeTrialsCount > 0
      //     ? (agents[admin.id].freeTrialTrend.attendedCount / agents[admin.id].freeTrialTrend.freeTrialsCount) * 100
      //     : 0;
      agents[admin.id].freeTrialTrend.attendanceRate =
        agents[admin.id].freeTrialTrend.freeTrialsCount > 0
          ? Number(
              (
                (agents[admin.id].freeTrialTrend.attendedCount /
                  agents[admin.id].freeTrialTrend.freeTrialsCount) *
                100
              ).toFixed(2)
            )
          : 0;

      if (
        ((b.type === "free" || b.trialDate !== null) &&
          (b.paymentPlanId !== null || b.startDate !== null)) ||
        (b.trialDate !== null && b.startDate !== null)
      ) {
        agents[admin.id].freeTrialTrend.trialToMemberCount += 1; // count this booking
      }

      agents[admin.id].freeTrialTrend.conversionRate =
        agents[admin.id].freeTrialTrend.freeTrialsCount > 0
          ? (agents[admin.id].freeTrialTrend.trialToMemberCount /
              agents[admin.id].freeTrialTrend.freeTrialsCount) *
            100
          : 0;

      if (b.status === "rebooked") {
        agents[admin.id].freeTrialTrend.rebookCount += 1;
      }
    });

    const agentSummary = Object.values(agents).sort(
      (a, b) =>
        b.freeTrialTrend.freeTrialsCount - a.freeTrialTrend.freeTrialsCount
    );

    if (!grouped[yearKey]) grouped[yearKey] = { monthlyGrouped: {} };
    const fbPerformance = facebookPerformance(monthBookings);
    const monthlyRevenue = calculateMonthlyRevenue(filteredBookings);

    // grouped[yearKey].monthlyGrouped[monthKey] = { bookings: filteredBookings, freeTrialTrend, agentSummary, enrolledStudents, paymentPlansTrend, marketingChannelPerformance };
    grouped[yearKey].monthlyGrouped[monthKey] = {
      bookings: filteredBookings,
      freeTrialTrend,
      agentSummary,
      enrolledStudents,
      paymentPlansTrend,
      marketingChannelPerformance,
      facebookPerformance: fbPerformance,
      revenue: monthlyRevenue,
    };

    current.add(1, "month");
  }

  // Month-over-month trends
  Object.keys(grouped).forEach((yearKey) => {
    const months = Object.keys(grouped[yearKey].monthlyGrouped).sort();
    months.forEach((monthKey, i) => {
      const monthData = grouped[yearKey].monthlyGrouped[monthKey];
      if (i === 0) {
        monthData.freeTrialTrend = calcPercentageDiff(
          monthData.freeTrialTrend,
          null
        );
        monthData.facebookPerformance = calcFacebookDiff(
          monthData.facebookPerformance,
          null
        );
        monthData.agentSummary = monthData.agentSummary.map((agent) => {
          const { freeTrialTrend, ...rest } = agent;

          let rawTrend = freeTrialTrend;
          if (rawTrend.currentMonthStats) rawTrend = rawTrend.currentMonthStats;

          return {
            ...rest,
            freeTrialTrend: calcPercentageDiff(rawTrend, null),
          };
        });
      } else {
        const lastMonthKey = months[i - 1];
        const lastMonthData = grouped[yearKey].monthlyGrouped[lastMonthKey];

        monthData.facebookPerformance = calcFacebookDiff(
          monthData.facebookPerformance,
          lastMonthData.facebookPerformance
        );

        monthData.freeTrialTrend = calcPercentageDiff(
          monthData.freeTrialTrend,
          lastMonthData.freeTrialTrend
        );
        monthData.agentSummary = monthData.agentSummary.map((agent) => {
          const prev = lastMonthData.agentSummary.find(
            (a) => a.id === agent.id
          );
          const { freeTrialTrend, ...rest } = agent;

          let currentRaw = freeTrialTrend;
          if (currentRaw.currentMonthStats)
            currentRaw = currentRaw.currentMonthStats;

          let prevRaw = prev?.freeTrialTrend;
          if (prevRaw?.currentMonthStats) prevRaw = prevRaw.currentMonthStats;

          return {
            ...rest,
            freeTrialTrend: calcPercentageDiff(currentRaw, prevRaw),
          };
        });
      }
    });

    // Yearly freeTrialTrend
    const yearTotal = {
      freeTrialsCount: 0,
      attendedCount: 0,
      attendanceRate: 0,
      trialToMemberCount: 0,
      conversionRate: 0,
      rebookCount: 0,
    };
    const lastYearTotal =
      grouped[String(Number(yearKey) - 1)]?.yearlyTotal || null;
    const yearlyMarketingPerformance = {};
    const yearlyFacebook = {
      leadsGenerated: 0,
      trialsBooked: 0,
      trialsAttended: 0,
      membershipsSold: 0,
      conversionRate: 0,
    };
    Object.values(grouped[yearKey].monthlyGrouped).forEach((m) => {
      const monthStats = m.freeTrialTrend.currentMonthStats;

      // ✅ Aggregate numeric stats
      yearTotal.freeTrialsCount += monthStats.freeTrialsCount;
      yearTotal.attendedCount += monthStats.attendedCount;
      // yearTotal.attendanceRate += monthStats.attendanceRate;
      yearTotal.attendanceRate =
        yearTotal.freeTrialsCount > 0
          ? Number(
              (
                (yearTotal.attendedCount / yearTotal.freeTrialsCount) *
                100
              ).toFixed(2)
            )
          : 0;

      yearTotal.trialToMemberCount += monthStats.trialToMemberCount;
      yearTotal.conversionRate += monthStats.conversionRate;
      yearTotal.rebookCount += monthStats.rebookCount;
      // Add revenue
      yearTotal.revenue = (yearTotal.revenue || 0) + (m.revenue || 0);

      const fb = m.facebookPerformance.currentMonthStats;

      yearlyFacebook.leadsGenerated += fb.leadsGenerated;
      yearlyFacebook.trialsBooked += fb.trialsBooked;
      yearlyFacebook.trialsAttended += fb.trialsAttended;
      yearlyFacebook.membershipsSold += fb.membershipsSold;
      yearlyFacebook.conversionRate =
        yearlyFacebook.leadsGenerated > 0
          ? Number(
              (
                (yearlyFacebook.membershipsSold /
                  yearlyFacebook.leadsGenerated) *
                100
              ).toFixed(2)
            )
          : 0;

      // ✅ Combine marketing channel performance across months
      const monthlyMarketing = m.marketingChannelPerformance || {};
      Object.entries(monthlyMarketing).forEach(([channel, count]) => {
        yearlyMarketingPerformance[channel] =
          (yearlyMarketingPerformance[channel] || 0) + count;
      });
    });
    grouped[yearKey].facebookPerformance = calcPercentageDiff(
      yearlyFacebook,
      grouped[String(Number(yearKey) - 1)]?.facebookPerformance
        ?.currentYearStats,
      true
    );

    // ✅ Store yearly marketing performance directly under the year group
    grouped[yearKey].marketingChannelPerformance = yearlyMarketingPerformance;

    // ✅ Compute percentage difference
    grouped[yearKey].freeTrialTrend = calcPercentageDiff(
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
    const bookings = await Booking.findAll({
      order: [["id", "DESC"]],
      where: {
        [Op.or]: [
          { bookingType: "free" },
          { bookingType: "paid" },
          { trialDate: { [Op.not]: null } },
        ],
      },
      include: [
        { model: Venue, as: "venue", required: false },
        { model: Lead, as: "lead", required: false },
        {
          model: BookingStudentMeta,
          as: "students",
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
        {
          model: PaymentPlan,
          as: "paymentPlan",
          attributes: ["id", "price"],
          required: false,
        },
      ],
    });

    const yealyGrouped = groupBookingsByYearMonth(
      bookings,
      filters,
      usedVenues
    );

    // Overall Sales
    const overallTrends = {
      freeTrialsCount: 0,
      attendedCount: 0,
      attendanceRate: 0,
      trialToMemberCount: 0,
      conversionRate: 0,
      rebookCount: 0,
    };
    const overallMarketingPerformance = {};

    Object.values(yealyGrouped).forEach((year) => {
      Object.values(year.monthlyGrouped).forEach((month) => {
        const s = month.freeTrialTrend.currentMonthStats;
        overallTrends.freeTrialsCount += s.freeTrialsCount;
        overallTrends.attendedCount += s.attendedCount;
        overallTrends.attendanceRate =
          overallTrends.freeTrialsCount > 0
            ? Number(
                (
                  (overallTrends.attendedCount /
                    overallTrends.freeTrialsCount) *
                  100
                ).toFixed(2)
              )
            : 0;

        overallTrends.conversionRate =
          overallTrends.freeTrialsCount > 0
            ? Number(
                (
                  (overallTrends.trialToMemberCount /
                    overallTrends.freeTrialsCount) *
                  100
                ).toFixed(2)
              )
            : 0;

        overallTrends.trialToMemberCount += s.trialToMemberCount;
        overallTrends.rebookCount += s.rebookCount;

        const monthlyMarketing = month.marketingChannelPerformance || {};
        Object.entries(monthlyMarketing).forEach(([channel, count]) => {
          overallMarketingPerformance[channel] =
            (overallMarketingPerformance[channel] || 0) + count;
        });
      });
    });

    return {
      status: true,
      message: "Monthly class report generated successfully.",
      data: {
        yealyGrouped,
        overallTrends,
        overallMarketingPerformance,
        allVenues: Array.from(usedVenues.values()),
      },
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

/* ================= FILTER HELPERS ================= */

function hasActiveFilters(filter = {}) {
  if (!filter) return false;

  return Boolean(
    filter.venueId ||
    filter.venue?.name ||
    filter.period
  );
}

function applyDashboardFilters(bookings, filter = {}) {
  // ✅ NO FILTER → return all bookings
  if (!hasActiveFilters(filter)) return bookings;

  return bookings.filter((b) => {
    let valid = true;

    /* ===== VENUE FILTER ===== */
    if (valid && filter.venueId) {
      valid = Number(b.venue?.id) === Number(filter.venueId);
    }

    /* ===== VENUE FILTER ===== */
    if (valid && filter.classScheduleId) {
      valid = Number(b.class?.id) === Number(filter.classScheduleId);
    }
    /* ===== PERIOD FILTER ===== */
    if (valid && filter.period) {
      const createdAt = moment(b.createdAt);
      const now = moment();

      if (filter.period === "thisMonth") {
        valid = createdAt.isSame(now, "month");
      } else if (filter.period === "thisQuarter") {
        valid = createdAt.isSame(now, "quarter");
      } else if (filter.period === "thisYear") {
        valid = createdAt.isSame(now, "year");
      }
    }

    return valid;
  });
}