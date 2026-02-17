const moment = require("moment");
const { Op } = require("sequelize");

const {
  Booking,
  BookingStudentMeta,
  ClassSchedule,
  Venue,
  Lead,
  BookingPayment,
  PaymentPlan,
  Admin,
} = require("../../../../models");

/* ================= METRICS ================= */

const METRIC_TRIAL_STATUSES = [
  "active",
  "pending",
  "cancelled",
  "attended",
];

// TOTAL TRIALS PER YEAR
function calculateTotalTrialsForYear(bookings, year) {
  return bookings.filter(
    (b) => moment(b.createdAt).year() === year
  ).length;
}

// ATTENDED BOOKINGS PER YEAR
function calculateAttendedTrialsForYear(bookings, year) {
  return bookings.filter(
    (b) =>
      b.status === "attended" &&
      moment(b.createdAt).year() === year
  ).length;
}

// ATTENDANCE RATE (attended / total bookings)
function calculateAttendanceRateForYear(bookings, year) {
  const totalBookings = calculateTotalTrialsForYear(bookings, year);
  const attendedBookings = calculateAttendedTrialsForYear(bookings, year);

  if (totalBookings === 0) return 0;

  return Number(((attendedBookings / totalBookings) * 100).toFixed(2));
}

// TRIALS CONVERTED TO MEMBERS (paid bookings marked as converted)
function calculateTrialsToMembers(bookings, year) {
  return bookings.filter(
    (b) =>
      b.bookingType === "paid" &&
      b.isConvertedToMembership === true &&
      moment(b.createdAt).year() === year
  ).length;
}

// Conversion Rate (converted memberships / total bookings)
function calculateConversionRate(bookings, year) {
  const totalBookings = calculateTotalTrialsForYear(bookings, year);

  const convertedBookings = bookings.filter(
    (b) =>
      b.bookingType === "paid" &&
      b.isConvertedToMembership === true &&
      moment(b.createdAt).year() === year
  ).length;

  if (totalBookings === 0) return 0;

  return Number(((convertedBookings / totalBookings) * 100).toFixed(2));
}

// No. of Rebooks per Year
function calculateNumberOfRebooking(bookings, year) {
  return bookings.filter(
    (b) =>
      b.bookingType === "free" &&
      b.status === "rebooked" &&
      moment(b.createdAt).year() === year
  ).length;
}

function generateTrialsComparisonGraph(bookings) {
  const now = moment();
  const currentYear = now.year();
  const previousYear = currentYear - 1;

  const labels = moment.monthsShort();

  const currentYearData = new Array(12).fill(0);
  const previousYearData = new Array(12).fill(0);

  bookings.forEach(b => {
    const year = moment(b.createdAt).year();
    const month = moment(b.createdAt).month();

    if (year === currentYear) {
      currentYearData[month]++;
    } else if (year === previousYear) {
      previousYearData[month]++;
    }
  });

  return {
    labels,
    series: [
      { name: `${currentYear} Bookings`, data: currentYearData },
      { name: `${previousYear} Bookings`, data: previousYearData },
    ],
  };
}

// Enrolled students
// Helper to calculate percentage for each group
function calculatePercentages(items) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items.map(item => ({
    ...item,
    percentage: total ? Number(((item.count / total) * 100).toFixed(2)) : 0,
  }));
}

// 1. Enrolled students by Age
function calculateEnrolledByAge(bookings) {
  const ageCounts = {};
  bookings.forEach(b => {
    (b.students || []).forEach(s => {
      if (s.age != null) {
        ageCounts[s.age] = (ageCounts[s.age] || 0) + 1;
      }
    });
  });

  const result = Object.entries(ageCounts)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([age, count]) => ({
      label: `${age} Years`,
      count,
    }));

  return calculatePercentages(result);
}

// 2. Enrolled students by Gender
function calculateEnrolledByGender(bookings) {
  const genderCounts = { male: 0, female: 0, other: 0 };
  bookings.forEach(b => {
    (b.students || []).forEach(s => {
      if (s.gender) {
        const genderKey = s.gender.toLowerCase();
        if (!genderCounts.hasOwnProperty(genderKey)) {
          genderCounts.other++;
        } else {
          genderCounts[genderKey]++;
        }
      } else {
        genderCounts.other++;
      }
    });
  });

  const result = Object.entries(genderCounts).map(([gender, count]) => ({
    label: gender.charAt(0).toUpperCase() + gender.slice(1),
    count,
  }));

  return calculatePercentages(result);
}

// 3. Enrolled students by Venue
function calculateEnrolledByVenue(bookings) {
  const venueCounts = {};
  bookings.forEach(b => {
    const venueName = b.classSchedule?.venue?.name || "Unknown Venue";
    const studentCount = (b.students || []).length;

    if (!venueCounts[venueName]) {
      venueCounts[venueName] = 0;
    }
    venueCounts[venueName] += studentCount;
  });

  const result = Object.entries(venueCounts).map(([venue, count]) => ({
    label: venue,
    count,
  }));

  return calculatePercentages(result);
}

function generatePlansOverview(bookings) {
  // Filter only converted paid bookings with payment plans
  const convertedBookings = bookings.filter(
    (b) =>
      b.bookingType === "paid" &&
      b.isConvertedToMembership === true &&
      b.paymentPlanId && // must have a payment plan id
      b.paymentPlan &&    // paymentPlan object loaded
      b.paymentPlan.title
  );

  // Aggregate counts and revenue by plan title
  const planMap = {};

  convertedBookings.forEach(b => {
    const title = b.paymentPlan.title;
    const price = Number(b.paymentPlan.price) || 0;

    if (!planMap[title]) {
      planMap[title] = {
        count: 0,
        revenue: 0,
      };
    }
    planMap[title].count += 1;
    planMap[title].revenue += price;
  });

  const totalMembers = convertedBookings.length;
  const totalRevenue = Object.values(planMap).reduce((sum, p) => sum + p.revenue, 0);

  // Format output array with counts and percentages
  const plansOverview = Object.entries(planMap).map(([title, data]) => ({
    title,
    members: {
      count: data.count,
      percentage: totalMembers ? Number(((data.count / totalMembers) * 100).toFixed(1)) : 0,
    },
    revenue: {
      amount: Number(data.revenue.toFixed(2)),
      percentage: totalRevenue ? Number(((data.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    },
  }));

  // Optionally, sort descending by member count or revenue
  plansOverview.sort((a, b) => b.members.count - a.members.count);
  console.log("Converted Bookings with Plans:", convertedBookings);

  return {
    plansOverview,
    totalRevenue: Number(totalRevenue.toFixed(3)), // Rounded to 3 decimals like £1.123
  };
}

// Facebook performance metrics calculation
async function calculateFacebookPerformance(year) {
  // Query all leads created in the given year with status 'facebook'
  const facebookLeads = await Lead.findAll({
    where: {
      status: 'facebook', // Adjust if your status field has a different name or value for Facebook leads
      createdAt: {
        [Op.gte]: moment(`${year}-01-01`).toDate(),
        [Op.lte]: moment(`${year}-12-31`).toDate(),
      },
    },
    attributes: ['id'],
    raw: true,
  });

  const facebookLeadIds = facebookLeads.map(lead => lead.id);

  if (facebookLeadIds.length === 0) {
    // No facebook leads this year
    return {
      leadsGenerated: 0,
      trialsBooked: 0,
      trialsAttended: 0,
      membershipsSold: 0,
      conversionRate: 0,
    };
  }

  // Get bookings linked to facebook leads in the same year
  const bookings = await Booking.findAll({
    where: {
      leadId: { [Op.in]: facebookLeadIds },
      createdAt: {
        [Op.gte]: moment(`${year}-01-01`).toDate(),
        [Op.lte]: moment(`${year}-12-31`).toDate(),
      },
      bookingType: { [Op.in]: ['free', 'paid'] },
      status: { [Op.ne]: 'cancelled' }, // optional: exclude cancelled
    },
    raw: true,
  });

  // Calculate leads generated (facebook leads count)
  const leadsGenerated = facebookLeadIds.length;

  // Calculate trials booked (free bookings linked to facebook leads)
  const trialsBooked = bookings.filter(b => b.bookingType === 'free').length;

  // Calculate trials attended (free bookings with status 'attended')
  const trialsAttended = bookings.filter(b => b.bookingType === 'free' && b.status === 'attended').length;

  // Calculate memberships sold (paid bookings marked as converted)
  const membershipsSold = bookings.filter(b => b.bookingType === 'paid' && b.isConvertedToMembership === true).length;

  // Calculate conversion rate = membershipsSold / trialsBooked * 100
  const conversionRate = trialsBooked > 0 ? Number(((membershipsSold / trialsBooked) * 100).toFixed(2)) : 0;

  return {
    leadsGenerated,
    trialsBooked,
    trialsAttended,
    membershipsSold,
    conversionRate,
  };
}
function calculateFacebookAverage(currentYearData, previousYearData) {
  // Helper to safely get average or 0 if both zero
  function avg(a, b) {
    return Number(((a + b) / 2).toFixed(2));
  }

  // Calculate conversion % for trialsBooked, trialsAttended, membershipsSold based on leadsGenerated (if leadsGenerated is 0, return 0 to avoid divide by zero)
  function calcConversion(value, leads) {
    if (leads === 0) return 0;
    return Number(((value / leads) * 100).toFixed(2));
  }

  // Average raw counts
  const avgLeadsGenerated = avg(currentYearData.leadsGenerated, previousYearData.leadsGenerated);
  const avgTrialsBooked = avg(currentYearData.trialsBooked, previousYearData.trialsBooked);
  const avgTrialsAttended = avg(currentYearData.trialsAttended, previousYearData.trialsAttended);
  const avgMembershipsSold = avg(currentYearData.membershipsSold, previousYearData.membershipsSold);

  // Average conversion rate from lead to sale
  const avgConversionRate = avg(currentYearData.conversionRate, previousYearData.conversionRate);

  // Conversion % for avg trialsBooked, attended, membershipsSold based on avg leads generated
  const trialsBookedConversion = calcConversion(avgTrialsBooked, avgLeadsGenerated);
  const trialsAttendedConversion = calcConversion(avgTrialsAttended, avgLeadsGenerated);
  const membershipsSoldConversion = calcConversion(avgMembershipsSold, avgLeadsGenerated);

  return {
    leadsGenerated: avgLeadsGenerated,
    trialsBooked: avgTrialsBooked,
    trialsBookedConversion,       // Conversion % of trials booked from leads
    trialsAttended: avgTrialsAttended,
    trialsAttendedConversion,     // Conversion % of trials attended from leads
    membershipsSold: avgMembershipsSold,
    membershipsSoldConversion,    // Conversion % of memberships sold from leads
    conversionRate: avgConversionRate, // Average lead to sale conversion rate you already calculate
  };
}

// Marketing channel performance gave as like is

const MARKETING_CHANNELS = [
  'facebook',
  'website',
  'instagram',
  'referral',
  'others',
];

async function marketingChannelPerformance(year) {
  // 1️⃣ Get bookings for the year (SOURCE OF TRUTH)
  const bookings = await Booking.findAll({
    where: {
      leadId: { [Op.ne]: null },
      createdAt: {
        [Op.gte]: moment(`${year}-01-01`).toDate(),
        [Op.lte]: moment(`${year}-12-31`).toDate(),
      },
      status: { [Op.ne]: 'cancelled' },
    },
    attributes: ['leadId'],
    raw: true,
  });

  if (!bookings.length) return [];

  const leadIds = [...new Set(bookings.map(b => b.leadId))];

  // 2️⃣ Fetch leads for those bookings (NO year filter here)
  const leads = await Lead.findAll({
    where: {
      id: { [Op.in]: leadIds },
    },
    attributes: ['id', 'status'],
    raw: true,
  });

  // 3️⃣ Count per channel
  const channelCounts = {};
  MARKETING_CHANNELS.forEach(ch => (channelCounts[ch] = 0));

  leads.forEach(lead => {
    const channel = lead.status?.toLowerCase();
    if (channelCounts.hasOwnProperty(channel)) {
      channelCounts[channel]++;
    } else {
      channelCounts.others++;
    }
  });

  // 4️⃣ Total
  const total = Object.values(channelCounts).reduce((a, b) => a + b, 0);

  // 5️⃣ Format for UI
  return Object.entries(channelCounts).map(([channel, count]) => ({
    label: channel.charAt(0).toUpperCase() + channel.slice(1),
    count,
    percentage: total
      ? Number(((count / total) * 100).toFixed(1))
      : 0,
  }));
}

function calculateTopAgentsFromBookings(bookings, year, limit = 5) {
  const agentMap = {};

  bookings.forEach(b => {
    if (!b.bookedBy) return;
    if (!['active', 'attended', 'pending'].includes(b.status)) return;
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

/* ================= DASHBOARD STATS ================= */

function calculateDashboardStats(bookings) {
  const now = moment();
  const currentYear = now.year();
  const previousYear = currentYear - 1;

  const currentYearTrials = calculateTotalTrialsForYear(bookings, currentYear);
  const previousYearTrials = calculateTotalTrialsForYear(bookings, previousYear);

  const currentYearAttended = calculateAttendedTrialsForYear(bookings, currentYear);
  const previousYearAttended = calculateAttendedTrialsForYear(bookings, previousYear);

  const currentYearAttendanceRate = calculateAttendanceRateForYear(bookings, currentYear);
  const previousYearAttendanceRate = calculateAttendanceRateForYear(bookings, previousYear);

  const currentYearConverted = calculateTrialsToMembers(bookings, currentYear);
  const previousYearConverted = calculateTrialsToMembers(bookings, previousYear);

  const currentYearConversionRate = calculateConversionRate(bookings, currentYear);
  const previousYearConversionRate = calculateConversionRate(bookings, previousYear);

  const currentYearRebooks = calculateNumberOfRebooking(bookings, currentYear);
  const previousYearRebooks = calculateNumberOfRebooking(bookings, previousYear);

  return {
    totalTrials: {
      currentYear: currentYearTrials,
      previousYear: previousYearTrials,
      average: Number(((currentYearTrials + previousYearTrials) / 2).toFixed(2)),
    },
    attendedTrials: {
      currentYear: currentYearAttended,
      previousYear: previousYearAttended,
      average: Number(((currentYearAttended + previousYearAttended) / 2).toFixed(2)),
    },
    attendanceRate: {
      currentYear: currentYearAttendanceRate,
      previousYear: previousYearAttendanceRate,
      average: Number(((currentYearAttendanceRate + previousYearAttendanceRate) / 2).toFixed(2)),
    },
    convertedTrialsToMembers: {
      currentYear: currentYearConverted,
      previousYear: previousYearConverted,
      average: Number(((currentYearConverted + previousYearConverted) / 2).toFixed(2)),
    },
    conversionRate: {
      currentYear: currentYearConversionRate,
      previousYear: previousYearConversionRate,
      average: Number(((currentYearConversionRate + previousYearConversionRate) / 2).toFixed(2)),
    },
    rebooks: {
      currentYear: currentYearRebooks,
      previousYear: previousYearRebooks,
      average: Number(((currentYearRebooks + previousYearRebooks) / 2).toFixed(2)),
    },
  };
}
/* ================= FILTER HELPERS ================= */

function applyVenueAndClassFilters(bookings, filter = {}) {
  return bookings.filter(b => {
    if (filter.venueId) {
      if (Number(b.classSchedule?.venue?.id) !== Number(filter.venueId)) {
        return false;
      }
    }

    if (filter.classScheduleId) {
      if (Number(b.classSchedule?.id) !== Number(filter.classScheduleId)) {
        return false;
      }
    }

    return true;
  });
}

function applyPeriodFilter(bookings, period) {
  if (!period) return bookings;

  return bookings.filter(b => {
    const createdAt = moment(b.createdAt);
    const now = moment();

    if (period === "thisMonth") {
      return createdAt.isSame(now, "month");
    }
    if (period === "thisQuarter") {
      return createdAt.isSame(now, "quarter");
    }
    if (period === "thisYear") {
      return createdAt.isSame(now, "year");
    }
    return true;
  });
}

/* ================= MAIN SERVICE ================= */

const getMonthlyReport = async (filters) => {
  try {
    // ----------------------------------
    // ACCESS CONTROL LOGIC
    // ----------------------------------
    let accessControl = {};
    let venueIncludeWhere = undefined;

    if (filters.bookedBy?.adminIds?.length) {
      const { type, adminIds } = filters.bookedBy;

      // SUPER ADMIN
      if (type === "super_admin") {
        accessControl = {
          [Op.or]: [
            { bookedBy: { [Op.in]: adminIds } },
            {
              bookedBy: null,
              status: "website",
              "$classSchedule.venue.createdBy$": {
                [Op.in]: adminIds,
              },
            },
          ],
        };
        venueIncludeWhere = {
          createdBy: { [Op.in]: adminIds },
        };
      }
      // ADMIN
      else if (type === "admin") {
        accessControl = {
          [Op.or]: [
            { bookedBy: { [Op.in]: adminIds } },
            {
              bookedBy: null,
              status: "website",
              "$classSchedule.venue.createdBy$": {
                [Op.in]: adminIds,
              },
            },
          ],
        };
        venueIncludeWhere = {
          createdBy: { [Op.in]: adminIds },
        };
      }
      // AGENT
      else {
        accessControl = {
          bookedBy: { [Op.in]: adminIds },
        };
      }
    }

    /* ================= FILTER HELPERS ================= */

    // ----------------------------------
    // QUERY BOOKINGS WITH ACCESS CONTROL
    // ----------------------------------
    const bookings = (
      await Booking.findAll({
        where: {
          bookingType: { [Op.in]: ["free", "paid"] },
          ...accessControl,
        },
        include: [
          {
            model: ClassSchedule,
            as: "classSchedule",
            required: true,
            include: [
              {
                model: Venue,
                as: "venue",
                required: true,
                where: venueIncludeWhere,
              },
            ],
          },
          { model: BookingStudentMeta, as: "students", required: false },
          { model: BookingPayment, as: "payments", required: false },
          { model: PaymentPlan, as: "paymentPlan", required: false },
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
    console.log("RAW BOOKINGS DATA:", JSON.stringify(bookings, null, 2));

    // ----------------------------------
    // ✅ COLLECT ALL VENUES
    const allVenues = Array.from(
      new Map(
        bookings
          .filter(b => b.classSchedule?.venue)
          .map(b => [
            b.classSchedule.venue.id,
            b.classSchedule.venue.name
          ])
      )
    ).map(([id, name]) => ({ id, name }));

    // ✅ COLLECT ALL CLASSES (ClassSchedule)
    const allClasses = Array.from(
      new Map(
        bookings
          .filter(b => b.classSchedule)
          .map(b => [
            b.classSchedule.id,
            {
              id: b.classSchedule.id,
              className: b.classSchedule.className,
              venueId: b.classSchedule.venue?.id || null,
            }
          ])
      ).values()
    );

    // Use currentYear, previousYear from moment
    const now = moment();
    const currentYear = now.year();
    const previousYear = currentYear - 1;
    const dashboardFilters = filters.dashboardFilters || {};
    // 1️⃣ Apply Venue + Class filters
    const venueClassFilteredBookings =
      applyVenueAndClassFilters(bookings, dashboardFilters);

    // 2️⃣ Apply Period filter (FINAL DATASET)
    const finalFilteredBookings =
      applyPeriodFilter(venueClassFilteredBookings, dashboardFilters.period);

    const stats = calculateDashboardStats(finalFilteredBookings);

    const trialsGraphData =
      generateTrialsComparisonGraph(finalFilteredBookings);

    const enrolledStudents = {
      byAge: calculateEnrolledByAge(finalFilteredBookings),
      byGender: calculateEnrolledByGender(finalFilteredBookings),
      byVenue: calculateEnrolledByVenue(finalFilteredBookings),
    };

    const { plansOverview, totalRevenue } =
      generatePlansOverview(finalFilteredBookings);

    const topAgents =
      calculateTopAgentsFromBookings(finalFilteredBookings, currentYear);

    const facebookPerformanceCurrentYear = await calculateFacebookPerformance(currentYear);
    const facebookPerformancePreviousYear = await calculateFacebookPerformance(previousYear);
    const facebookPerformanceAverage = calculateFacebookAverage(facebookPerformanceCurrentYear, facebookPerformancePreviousYear);
    const marketingChannels = await marketingChannelPerformance(currentYear);

    // Count bookings by year
    const bookingsPreviousYearCount =
      venueClassFilteredBookings.filter(b =>
        moment(b.createdAt).year() === previousYear
      ).length;

    console.log("Previous Year Booking Count:", bookingsPreviousYearCount);

    return {
      status: true,
      data: {
        summary: stats,
        graph: {
          trialsComparison: trialsGraphData,
        },
        enrolledData: enrolledStudents,
        membershipPlansAacquiredPostTrial: plansOverview,
        revenueFromMemberships: totalRevenue,
        facebookPerformance: {
          currentYear: facebookPerformanceCurrentYear,
          previousYear: facebookPerformancePreviousYear,
          average: facebookPerformanceAverage,
        },
        marketingChannelPerformance: marketingChannels,
        topAgents,
        allVenues,
        allClasses,
        previousYearBookingCount: bookingsPreviousYearCount, // ✅ added
      },
    };
  } catch (error) {
    console.error(error);
    return {
      status: false,
      message: "Failed to fetch report data",
    };
  }
};

module.exports = { getMonthlyReport };
