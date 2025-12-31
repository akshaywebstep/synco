const moment = require("moment");
const { Op } = require("sequelize");

const {
  Booking,
  BookingStudentMeta,
  BookingPayment,
  PaymentPlan,
  Admin,
  Lead,
  Venue,
} = require("../../../../models");

/* ================= CONSTANTS ================= */
const VALID_MEMBER_STATUSES = ["active", "attended", "cancelled"];
const PAID_TYPE = "paid";
const usedVenues = new Map();
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

/* ================= METRICS ================= */

// 1️⃣ TOTAL MEMBERS (CURRENT YEAR)
function calculateTotalMembersForPeriod(bookings, year, month) {
  const students = new Set();

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;
    if (
      moment(b.createdAt).year() !== year ||
      moment(b.createdAt).month() !== month
    ) return;

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

// 4️⃣ AVERAGE LIFE CYCLE (MONTHS)
function calculateAverageLifeCycle(bookings, year, month) {
  let totalMonths = 0;
  let count = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;
    if (moment(b.createdAt).year() !== year) return;
    if (moment(b.createdAt).month() !== month) return;
    if (!b.paymentPlan) return;

    const months = convertPlanToMonths(b.paymentPlan);
    if (!months) return;

    totalMonths += months;
    count++;
  });

  return count ? Number((totalMonths / count).toFixed(2)) : 0;
}

// 5️⃣ NEW STUDENTS
function calculateNewStudents(bookings, year, month) {
  let count = 0;

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;

    (b.students || []).forEach(s => {
      if (
        moment(s.createdAt).year() === year &&
        moment(s.createdAt).month() === month
      ) {
        count++;
      }
    });
  });

  return count;
}

// 6️⃣ RETENTION (FIXED – REAL SUBSCRIPTION LOGIC)
function calculateRetentionForMonth(bookings, year, month) {
  const monthStart = moment().year(year).month(month).startOf("month");
  const monthEnd = monthStart.clone().endOf("month");

  const startActiveStudents = new Set();
  const endActiveStudents = new Set();

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;
    if (!b.paymentPlan) return;

    const bookingStart = moment(b.createdAt);
    const bookingEnd = getBookingEndDate(b);

    if (!bookingEnd) return;

    (b.students || []).forEach(s => {
      // Active at START of month
      if (
        bookingStart.isSameOrBefore(monthStart) &&
        bookingEnd.isAfter(monthStart)
      ) {
        startActiveStudents.add(s.id);
      }

      // Active at END of month
      if (
        bookingStart.isSameOrBefore(monthEnd) &&
        bookingEnd.isAfter(monthEnd)
      ) {
        endActiveStudents.add(s.id);
      }
    });
  });

  if (!startActiveStudents.size) return 0;

  // retained = students active at start AND end
  let retained = 0;
  startActiveStudents.forEach(id => {
    if (endActiveStudents.has(id)) retained++;
  });

  return Number(((retained / startActiveStudents.size) * 100).toFixed(2));
}
function calculateActiveMembersForMonth(bookings, year, month) {
  const monthStart = moment().year(year).month(month).startOf("month");
  const monthEnd = monthStart.clone().endOf("month");

  const students = new Set();

  bookings.forEach(b => {
    if (b.bookingType !== PAID_TYPE) return;
    if (!VALID_MEMBER_STATUSES.includes(b.status)) return;
    if (!b.paymentPlan) return;

    const bookingStart = moment(b.createdAt);
    const bookingEnd = getBookingEndDate(b);

    if (!bookingEnd) return;

    // Booking must cover the month
    if (
      bookingStart.isSameOrBefore(monthEnd) &&
      bookingEnd.isSameOrAfter(monthStart)
    ) {
      (b.students || []).forEach(s => students.add(s.id));
    }
  });

  return students.size;
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

  const labels = moment.monthsShort(); // ["Jan","Feb",...]
  const currentYearData = [];
  const previousYearData = [];

  for (let month = 0; month < 12; month++) {
    currentYearData.push(
      calculateActiveMembersForMonth(bookings, currentYear, month)
    );

    previousYearData.push(
      calculateActiveMembersForMonth(bookings, previousYear, month)
    );
  }

  return {
    labels,
    series: [
      {
        name: `${currentYear} Members`,
        data: currentYearData,
      },
      {
        name: `${previousYear} Members`,
        data: previousYearData,
      },
    ],
  };
}

/* ================= DASHBOARD ================= */

function calculateDashboardStats(filteredBookings) {
  const now = moment();
  const year = now.year();
  const month = now.month();
  const prev = now.clone().subtract(1, "month");

  const retentionCurrent = calculateRetentionForMonth(
    filteredBookings,
    year,
    month
  );

  const retentionPrevious = calculateRetentionForMonth(
    filteredBookings,
    prev.year(),
    prev.month()
  );

  const totalMembersCurrent = calculateTotalMembersForPeriod(
    filteredBookings,
    year,
    month
  );

  const totalMembersPrevious = calculateTotalMembersForPeriod(
    filteredBookings,
    prev.year(),
    prev.month()
  );

  return {
    totalMembers: {
      current: totalMembersCurrent,
      previous: totalMembersPrevious,
      average: Number(
        ((totalMembersCurrent + totalMembersPrevious) / 2).toFixed(2)
      ),
    },

    monthlyRevenue: {
      current: calculateMonthlyRevenue(filteredBookings, year, month),
      previous: calculateMonthlyRevenue(
        filteredBookings,
        prev.year(),
        prev.month()
      ),
      average: Number(
        (
          (calculateMonthlyRevenue(filteredBookings, year, month) +
            calculateMonthlyRevenue(
              filteredBookings,
              prev.year(),
              prev.month()
            )) / 2
        ).toFixed(2)
      ),
    },

    averageMonthlyFee: {
      current: calculateAverageMonthlyFee(filteredBookings, year, month),
      previous: calculateAverageMonthlyFee(
        filteredBookings,
        prev.year(),
        prev.month()
      ),
      average: Number(
        (
          (calculateAverageMonthlyFee(filteredBookings, year, month) +
            calculateAverageMonthlyFee(
              filteredBookings,
              prev.year(),
              prev.month()
            )) / 2
        ).toFixed(2)
      ),
    },

    averageLifeCycle: {
      current: calculateAverageLifeCycle(filteredBookings, year, month),
      previous: calculateAverageLifeCycle(
        filteredBookings,
        prev.year(),
        prev.month()
      ),
      average: Number(
        (
          (calculateAverageLifeCycle(filteredBookings, year, month) +
            calculateAverageLifeCycle(
              filteredBookings,
              prev.year(),
              prev.month()
            )) / 2
        ).toFixed(2)
      ),
    },

    newStudents: {
      current: calculateNewStudents(filteredBookings, year, month),
      previous: calculateNewStudents(
        filteredBookings,
        prev.year(),
        prev.month()
      ),
      average: Number(
        (
          (calculateNewStudents(filteredBookings, year, month) +
            calculateNewStudents(
              filteredBookings,
              prev.year(),
              prev.month()
            )) / 2
        ).toFixed(2)
      ),
    },

    retention: {
      current: retentionCurrent,
      previous: retentionPrevious,
      average: Number(((retentionCurrent + retentionPrevious) / 2).toFixed(2)),
    },
  };
}

function applyDashboardFilters(bookings, filter = {}) {
  return bookings.filter(b => {
    let valid = true;

    /* ================= AGE FILTER ================= */
    if (valid && filter.age) {
      if (filter.age === "under18") {
        valid = b.students?.some(s => Number(s.age) < 18);
      } else if (filter.age === "18-25") {
        valid = b.students?.some(
          s => Number(s.age) >= 18 && Number(s.age) <= 25
        );
      } else if (filter.age === "allAges") {
        valid = true;
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
      bookingType: { [Op.in]: ["paid", "waiting list"] },
      status: { [Op.in]: ["active", "cancelled", "expired"] },
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
        summary: calculateDashboardStats(filteredBookings)
        ,
        graph: {
          membersComparison: generateMembersComparisonGraph(filteredBookings),
        },
        durationOfMemberships: calculateMembershipDurationBreakdown(filteredBookings),
        enrolledStudents: {
          byAge: calculateEnrolledByAge(filteredBookings),
          byGender: calculateEnrolledByGender(filteredBookings),
        },
        plansOverview: planUsageAndRevenue,
        membershipSource,
        allVenues, // ✅ Add this to response
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
