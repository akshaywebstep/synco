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

/* ================= CONSTANTS ================= */
const VALID_MEMBER_STATUSES = ["active", "cancelled"];
const PAID_TYPE = "paid";
/* ================= HELPERS ================= */
function getBookingEndDate(booking) {
  if (!booking.paymentPlan) return null;

  const start = moment(booking.createdAt);
  const months = convertPlanToMonths(booking.paymentPlan);

  return start.clone().add(months, "months");
}

function convertPlanToMonths(paymentPlan) {
  if (!paymentPlan || !paymentPlan.interval || !paymentPlan.duration) return 0;

  const interval = paymentPlan.interval.toLowerCase();
  const duration = Number(paymentPlan.duration);

  switch (interval) {
    case "month":
      return duration;

    case "quarter":
      return duration * 3;

    case "year":
      return duration * 12;

    default:
      return 0;
  }
}
function calculateMembersCreatedInMonth(bookings, year, month) {
  const students = new Set();

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;

    if (
      moment(b.createdAt).year() === year &&
      moment(b.createdAt).month() === month
    ) {
      (b.students || []).forEach(s => students.add(s.id));
    }
  });

  return students.size;
}

/* ================= METRICS ================= */

// 1️⃣ TOTAL MEMBERS (CURRENT YEAR)
const ACTIVE_STATUS = "active";

function calculateTotalNewStudentsForPeriod(bookings, year, month) {
  const students = new Set();

  bookings.forEach(b => {
    // ✅ booking must be PAID
    if (b.bookingType !== PAID_TYPE) return;

    // ✅ booking must be ACTIVE
    if (b.status !== ACTIVE_STATUS) return;

    // ✅ must be in given month/year
    if (
      moment(b.createdAt).year() !== year ||
      moment(b.createdAt).month() !== month
    ) return;

    // ✅ add students from ACTIVE bookings only
    (b.students || []).forEach(s => students.add(s.id));
  });

  return students.size;
}

// 2️⃣ MONTHLY REVENUE
function calculateMonthlyRevenue(bookings, year, month) {
  return bookings.reduce((sum, b) => {
    if (
      b.bookingType === PAID_TYPE &&
      VALID_MEMBER_STATUSES.includes(b.status) &&
      moment(b.createdAt).year() === year &&
      moment(b.createdAt).month() === month
    ) {
      sum += (Number(b.paymentPlan?.price) || 0) * (b.students?.length || 0);
    }
    return sum;
  }, 0);
}

// 3️⃣ AVERAGE MONTHLY FEE
function calculateAverageMonthlyFee(bookings, year, month) {
  let total = 0;
  let count = 0;

  bookings.forEach(b => {
    if (
      b.bookingType === PAID_TYPE &&
      VALID_MEMBER_STATUSES.includes(b.status) &&
      moment(b.createdAt).year() === year &&
      moment(b.createdAt).month() === month &&
      b.paymentPlan?.price
    ) {
      total += Number(b.paymentPlan.price);
      count++;
    }
  });

  return count ? Number((total / count).toFixed(2)) : 0;
}

// 4️⃣ GROWTH COMPARISON (student-count based)
// 4️⃣ GROWTH COMPARISON (ACTIVE + PAID, created in month)
function calculateGrowthComparison(bookings, thisYear, lastYear, month) {
  let thisYearCount = 0;
  let lastYearCount = 0;

  bookings.forEach(b => {
    // Only PAID + ACTIVE bookings
    if (b.bookingType !== PAID_TYPE) return;
    if (b.status !== "active") return;

    const bookingYear = moment(b.createdAt).year();
    const bookingMonth = moment(b.createdAt).month();

    // Same month comparison
    if (bookingMonth !== month) return;

    // Count students per booking
    const studentCount = (b.students || []).length;

    if (bookingYear === thisYear) thisYearCount += studentCount;
    if (bookingYear === lastYear) lastYearCount += studentCount;
  });

  return {
    thisYear: thisYearCount,
    lastYear: lastYearCount,
  };
}

// 5️⃣ CANCELLED STUDENTS (student-count based)
function calculateCancelledStudentsComparison(bookings, thisYear, lastYear, month) {
  let thisYearCount = 0;
  let lastYearCount = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (b.status !== "cancelled") return;

    const bookingYear = moment(b.createdAt).year();
    const bookingMonth = moment(b.createdAt).month();

    if (bookingMonth !== month) return;

    const studentCount = (b.students || []).length;

    if (bookingYear === thisYear) thisYearCount += studentCount;
    if (bookingYear === lastYear) lastYearCount += studentCount;
  });

  return {
    current: thisYearCount,
    previous: lastYearCount,
    average: Number(((thisYearCount + lastYearCount) / 2).toFixed(2)),
  };
}

// 6️⃣ RETENTION (FIXED – REAL SUBSCRIPTION LOGIC)
function calculateVariance(current, previous) {
  if (!previous) return current ? 100 : 0;

  return Number((((current - previous) / previous) * 100).toFixed(2));
}
function buildVarianceSummary(summary) {
  return {
    current: calculateVariance(
      summary.totalStudents.current,
      summary.totalStudents.previous
    ),

    previous: calculateVariance(
      summary.growthComparison.current,
      summary.growthComparison.previous
    ),

    average: Number(
      (
        (
          calculateVariance(
            summary.totalStudents.current,
            summary.totalStudents.previous
          ) +
          calculateVariance(
            summary.growthComparison.current,
            summary.growthComparison.previous
          )
        ) / 2
      ).toFixed(2)
    ),
  };
}

// Duration of membership
function calculateMembershipDurationBreakdown(bookings) {
  const buckets = {
    "1-2 Months": 0,
    "3-4 Months": 0,
    "5-6 Months": 0,
    "7-8 Months": 0,
    "9-10 Months": 0,
    "11-12 Months": 0,
  };

  let total = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;
    if (!b.paymentPlan) return;

    const months = convertPlanToMonths(b.paymentPlan);
    if (!months) return;

    total++;

    if (months <= 2) buckets["1-2 Months"]++;
    else if (months <= 4) buckets["3-4 Months"]++;
    else if (months <= 6) buckets["5-6 Months"]++;
    else if (months <= 8) buckets["7-8 Months"]++;
    else if (months <= 10) buckets["9-10 Months"]++;
    else if (months >= 11) buckets["11-12 Months"]++;
  });

  // Convert to percentages
  return Object.entries(buckets).map(([label, count]) => ({
    label,
    percentage: total ? Number(((count / total) * 100).toFixed(1)) : 0,
  }));
}

// 7️⃣ ENROLLED STUDENTS BY AGE
function calculateEnrolledByAge(bookings) {
  const ageCounts = {};
  let total = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;

    (b.students || []).forEach(s => {
      if (s.age) {
        ageCounts[s.age] = (ageCounts[s.age] || 0) + 1;
        total++;
      }
    });
  });

  // Convert to array with count and percentage
  return Object.entries(ageCounts)
    .sort((a, b) => Number(a[0]) - Number(b[0])) // Sort by age ascending
    .map(([age, count]) => ({
      label: `${age} Years`,
      count,
      percentage: total ? Number(((count / total) * 100).toFixed(2)) : 0,
    }));
}

// 8️⃣ ENROLLED STUDENTS BY GENDER
function calculateEnrolledByGender(bookings) {
  const genderCounts = { male: 0, female: 0, other: 0 };
  let total = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;

    (b.students || []).forEach(s => {
      if (s.gender) {
        const genderKey = s.gender.toLowerCase();
        if (!genderCounts.hasOwnProperty(genderKey)) {
          genderCounts[genderKey] = 0; // For unexpected genders
        }
        genderCounts[genderKey]++;
        total++;
      }
    });
  });

  return Object.entries(genderCounts).map(([gender, count]) => ({
    label: gender.charAt(0).toUpperCase() + gender.slice(1),
    count,
    percentage: total ? Number(((count / total) * 100).toFixed(2)) : 0,
  }));
}

// Members plan
function calculatePlanUsageAndRevenue(bookings) {
  const planMap = {};
  let totalMembers = 0;
  let totalRevenue = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;
    if (!b.paymentPlan || !b.paymentPlan.title) return;

    const title = b.paymentPlan.title;
    const price = Number(b.paymentPlan.price) || 0;
    const studentCount = b.students?.length || 0;
    const revenue = price * studentCount;

    if (!planMap[title]) {
      planMap[title] = {
        title,
        members: 0,
        revenue: 0,
      };
    }

    planMap[title].members += studentCount;
    planMap[title].revenue += revenue;

    totalMembers += studentCount;
    totalRevenue += revenue;
  });

  return Object.values(planMap).map(plan => ({
    title: plan.title,

    // MEMBERS DATA (for donut)
    members: {
      count: plan.members,
      percentage: totalMembers
        ? Number(((plan.members / totalMembers) * 100).toFixed(1))
        : 0,
    },

    // REVENUE DATA
    revenue: {
      amount: plan.revenue,
      percentage: totalRevenue
        ? Number(((plan.revenue / totalRevenue) * 100).toFixed(1))
        : 0,
    },
  }));
}

function calculateMembershipSource(bookings) {
  const sourceMap = {};
  let totalBookings = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;

    // ✅ booking must have leadId
    if (!b.leadId || !b.lead) return;

    const source = b.lead.status
      ? b.lead.status.trim().toLowerCase()
      : "others";

    if (!sourceMap[source]) {
      sourceMap[source] = 0;
    }

    // ✅ 1 booking = 1 count
    sourceMap[source] += 1;
    totalBookings += 1;
  });

  return Object.entries(sourceMap).map(([source, count]) => ({
    label: source.charAt(0).toUpperCase() + source.slice(1),
    count,
    percentage: totalBookings
      ? Number(((count / totalBookings) * 100).toFixed(1))
      : 0,
  }));
}

function generateMembersComparisonGraph(bookings) {
  const now = moment();
  const currentYear = now.year();
  const previousYear = currentYear - 1;

  // ✅ Only active bookings
  const activeBookings = bookings.filter(
    booking => booking.status === 'active'
  );

  const labels = moment.monthsShort();
  const currentYearData = [];
  const previousYearData = [];

  for (let month = 0; month < 12; month++) {
    currentYearData.push(
      calculateMembersCreatedInMonth(activeBookings, currentYear, month)
    );

    previousYearData.push(
      calculateMembersCreatedInMonth(activeBookings, previousYear, month)
    );
  }

  return {
    labels,
    series: [
      { name: `${currentYear} Members`, data: currentYearData },
      { name: `${previousYear} Members`, data: previousYearData },
    ],
  };
}

function calculateTopAgentsFromBookings(bookings, year, limit = 5) {
  const agentMap = {};

  bookings.forEach(b => {
    if (!b.bookedBy) return;
    if (!['active'].includes(b.status)) return;
    if (moment(b.createdAt).year() !== year) return;

    agentMap[b.bookedBy] = (agentMap[b.bookedBy] || 0) + 1;
  });

  return Object.entries(agentMap)
    .map(([agentId, count]) => {
      const agent = bookings
        .map(b => b.bookedByAdmin)
        .find(a => a && a.id == agentId);

      return {
        agentId: Number(agentId),
        name: agent
          ? `${agent.firstName || ''} ${agent.lastName || ''}`.trim()
          : 'Unknown Agent',
        profile: agent?.profile || null,
        totalBookings: count,
      };
    })
    .sort((a, b) => b.totalBookings - a.totalBookings)
    .slice(0, limit);
}
/* ================= DASHBOARD ================= */

function buildSummary(current, previous) {
  return {
    current,
    previous,
    average: Number(((current + previous) / 2).toFixed(2)),
  };
}

function calculateDashboardStats({ allBookings, filteredBookings }) {
  const now = moment();
  const year = now.year();
  const month = now.month();
  const prev = now.clone().subtract(1, "month");

  // ✅ Use ALL bookings for YoY growth
  const growthCounts = calculateGrowthComparison(
    allBookings,
    year,
    year - 1,
    month
  );

  const growthComparison = {
    current: growthCounts.thisYear,
    previous: growthCounts.lastYear,
    average: Number(
      ((growthCounts.thisYear + growthCounts.lastYear) / 2).toFixed(2)
    ),
  };

  return {
    totalStudents: buildSummary(
      calculateTotalNewStudentsForPeriod(filteredBookings, year, month),
      calculateTotalNewStudentsForPeriod(
        filteredBookings,
        prev.year(),
        prev.month()
      )
    ),

    monthlyRevenue: buildSummary(
      calculateMonthlyRevenue(filteredBookings, year, month),
      calculateMonthlyRevenue(
        filteredBookings,
        prev.year(),
        prev.month()
      )
    ),

    averageMonthlyFee: buildSummary(
      calculateAverageMonthlyFee(filteredBookings, year, month),
      calculateAverageMonthlyFee(
        filteredBookings,
        prev.year(),
        prev.month()
      )
    ),

    // ✅ FIXED
    growthComparison,

    cancelledStudents: buildSummary(
      calculateCancelledStudentsComparison(
        allBookings,
        year,
        year - 1,
        month
      ).current,
      calculateCancelledStudentsComparison(
        allBookings,
        prev.year(),
        prev.year() - 1,
        prev.month()
      ).current
    ),
    // ✅ ONLY ADD THIS
    variance: buildVarianceSummary({
      totalStudents: buildSummary(
        calculateTotalNewStudentsForPeriod(filteredBookings, year, month),
        calculateTotalNewStudentsForPeriod(
          filteredBookings,
          prev.year(),
          prev.month()
        )
      ),
      growthComparison // ✅ ADD THIS
    })
  };
}

function applyDashboardFilters(bookings, filter = {}) {
  return bookings.filter(b => {
    let valid = true;

    /* ================= AGE FILTER (DYNAMIC + ALL AGES) ================= */
    if (valid && filter.age) {

      // ✅ Case 1: "all" → do NOT filter
      if (filter.age === "all") {
        valid = true;
      }

      // ✅ Case 2: dynamic range
      else if (typeof filter.age === "object") {
        const { min, max } = filter.age;

        // If both missing → treat as ALL
        if (min == null && max == null) {
          valid = true;
        } else {
          valid = b.students?.some(s => {
            const age = Number(s.age);
            if (isNaN(age)) return false;

            if (min != null && age < min) return false;
            if (max != null && age > max) return false;

            return true;
          });
        }
      }
    }

    /* ================= VENUE FILTER ================= */
    /* ================= VENUE FILTER ================= */
    if (valid) {
      if (filter.venueId) {
        valid = b.venue?.id === filter.venueId;
      }
      else if (filter.venue?.name?.trim()) {
        const search = filter.venue.name.trim().toLowerCase();
        valid = (b.venue?.name || "").toLowerCase() === search;
      }
    }

    /* ================= PERIOD FILTER ================= */
    if (valid && filter.period) {
      const now = moment();

      if (filter.period === "thisMonth") {
        valid =
          moment(b.createdAt).isSameOrAfter(now.clone().startOf("month")) &&
          moment(b.createdAt).isSameOrBefore(now.clone().endOf("month"));
      }

      else if (filter.period === "thisQuarter") {
        valid =
          moment(b.createdAt).isSameOrAfter(now.clone().startOf("quarter")) &&
          moment(b.createdAt).isSameOrBefore(now.clone().endOf("quarter"));
      }

      else if (filter.period === "thisYear") {
        valid =
          moment(b.createdAt).isSameOrAfter(now.clone().startOf("year")) &&
          moment(b.createdAt).isSameOrBefore(now.clone().endOf("year"));
      }
    }

    return valid;
  });
}

/* ================= MAIN SERVICE ================= */

const getMonthlyReport = async (filters) => {
  try {
    const { adminId, superAdminId } = filters;

    const whereBooking = {
      bookingType: { [Op.in]: ["paid",] },
      status: { [Op.in]: ["active", "cancelled"] },
    };

    if (superAdminId && superAdminId === adminId) {
      const admins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      whereBooking.bookedBy = {
        [Op.in]: admins.map(a => a.id).concat(superAdminId),
      };
    } else {
      whereBooking.bookedBy = { [Op.in]: [adminId, superAdminId] };
    }

    const bookings = (
      await Booking.findAll({
        where: whereBooking,
        include: [
          { model: BookingStudentMeta, as: "students" },
          { model: BookingPayment, as: "payments", required: false },
          { model: PaymentPlan, as: "paymentPlan", required: false },
          {
            model: Lead,
            as: "lead",
            attributes: ["id", "status"],
            required: false,
          },
          {
            model: Venue,           // ✅ JOIN VENUE
            as: "venue",
            attributes: ["id", "name"],
            required: false,
          },
          {
            model: Admin,
            as: 'bookedByAdmin',
            attributes: ['id', 'firstName', 'lastName', 'profile'],
            required: false,
          }
        ],
        order: [["id", "DESC"]],
      })
    ).map(b => b.get({ plain: true }));
    // ✅ COLLECT ALL VENUES
    const allVenues = Array.from(
      new Map(
        bookings
          .filter(b => b.venue)
          .map(b => [b.venue.id, b.venue.name])
      )
    ).map(([id, name]) => ({ id, name }));

    const { filter } = filters;

    const filteredBookings = applyDashboardFilters(bookings, filter);

    // ✅ NOW SAFE
    const planUsageAndRevenue =
      calculatePlanUsageAndRevenue(filteredBookings);

    const membershipSource =
      calculateMembershipSource(filteredBookings);

    return {
      status: true,
      message: "Dashboard summary generated successfully.",
      data: {
        summary: calculateDashboardStats({
          allBookings: bookings,
          filteredBookings
        }),
        graph: {
          membersComparison: generateMembersComparisonGraph(filteredBookings),
        },
        // durationOfMemberships: calculateMembershipDurationBreakdown(filteredBookings),
        enrolledStudents: {
          byAge: calculateEnrolledByAge(filteredBookings),
          byGender: calculateEnrolledByGender(filteredBookings),
        },
        plansOverview: planUsageAndRevenue,
        membershipSource,
        topAgents: calculateTopAgentsFromBookings(filteredBookings, moment().year(), 5),
        allVenues,
      },
    };

  } catch (error) {
    console.error("❌ Dashboard Summary Error:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error generating dashboard summary.",
    };
  }
};

module.exports = { getMonthlyReport };
