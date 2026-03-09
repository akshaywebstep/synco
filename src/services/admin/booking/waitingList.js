const {
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  PaymentPlan,
  PaymentGroup,
  PaymentGroupHasPlan,
  TermGroup,
  Term,
  Venue,
  Admin,
  CancelBooking,
  BookingPayment,
  AdminRole,
  AppConfig,
  StarterPack,
} = require("../../../models");
const { sequelize } = require("../../../models");
const chargeStarterPack = require("../../../utils/payment/pay360/starterPackCharge");
const {
  createBillingRequest,
  createPayment,
  createMandate,
  createSubscription,
  createOneOffPaymentGc,
  createOneOffPaymentGcViaApi,
} = require("../../../utils/payment/pay360/payment");
const {
  createCustomer,
  createBankAccount,
  removeCustomer,
} = require("../../../utils/payment/pay360/customer");
const {
  createSchedule,
  getSchedules,
  createAccessPaySuiteCustomer,
  createContract,
  createOneOffPayment,
  createCustomerPayment,
  createContractPayment,
} = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const generateReferralCode = require("../../../utils/generateReferralCode");
const gbpToPence = (amount) => Math.round(Number(amount) * 100);
const DEBUG = process.env.DEBUG === "true";
const bcrypt = require("bcrypt");
const { Sequelize, Op } = require("sequelize");

const axios = require("axios");

function generateBookingId(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function calculateContractStartDate(delayDays = 18) {
  const start = new Date();
  start.setDate(start.getDate() + delayDays);
  start.setHours(0, 0, 0, 0);
  return start.toISOString().split("T")[0];
}

function findMatchingSchedule(schedules) {
  if (!Array.isArray(schedules)) return null;

  return schedules.find(
    (s) => s.Name && s.Name.trim().toLowerCase() === "monthly",
  );
}


// ================= DATE HELPERS =================
function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T00:00:00.000`; // APS required format
}

function addWorkingDays(startDate, days) {
  const result = new Date(startDate);
  let addedDays = 0;
  while (addedDays < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) addedDays++; // skip weekends
  }
  return result;
}


// For APS monthly schedule with DaysOfMonth = 1
// ================= FIXED APS NEXT PAYMENT DATE =================
function getAPSNextPaymentDateFixed(monthOffset = 0) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const earliestDate = addWorkingDays(today, 10);

  let year = earliestDate.getFullYear();
  let month = earliestDate.getMonth();

  // Move to next month if earliestDate is after 1st
  if (earliestDate.getDate() > 1) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  // Apply monthOffset for recurring months
  month += monthOffset;
  if (month > 11) {
    year += Math.floor(month / 12);
    month = month % 12;
  }

  const startDate = new Date(year, month, 1); // always 1st
  return formatDateLocal(startDate); // APS format YYYY-MM-DDT00:00:00.000
}

// 🟢 Helper: create a payment row
async function createBookingPayment({
  bookingId,
  studentId,
  parent,
  firstName,
  lastName,
  email,
  amount,
  paymentType,
  description,
  paymentCategory = "recurring",
  gatewayResponse = null,
  currency = "GBP",
  merchantId = null,
  paymentStatus,
  goCardlessMandateId,
  goCardlessSubscriptionId,
  goCardlessPaymentId,
}) {
  return await BookingPayment.create({
    bookingId,
    studentId,
    firstName,
    lastName,
    email,
    amount,
    price: amount,
    paymentType,
    description,
    paymentCategory,
    paymentStatus, // ✅ NOW real status use hoga
    currency,
    merchantRef:
      gatewayResponse?.transaction?.merchantRef || `TXN-${Date.now()}`,
    gatewayResponse,
    goCardlessMandateId, // ✅ SAVED
    goCardlessSubscriptionId, // ✅ SAVED
    account_holder_name: parent?.account_holder_name || null,
    account_number: parent?.account_number || null,
    branch_code: parent?.branch_code || null,
    goCardlessCustomer: gatewayResponse?.goCardlessCustomer || null,
    goCardlessBankAccount: gatewayResponse?.goCardlessBankAccount || null,
    goCardlessBillingRequest: gatewayResponse?.goCardlessBillingRequest || null,
    goCardlessPaymentId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}


async function updateBookingStats() {
  const debugData = [];

  try {
    const bookings = await Booking.findAll(); // now checking ALL bookings

    if (!bookings || bookings.length === 0) {
      return {
        status: false,
        message: "No bookings found.",
        data: debugData,
      };
    }

    const now = new Date();

    for (const booking of bookings) {
      const bookingDebug = {
        bookingId: booking.id,
        startDate: booking.startDate,
        status: booking.status,
        actions: [],
      };

      // ================================
      // 🔹 Only Expire Waiting List Logic
      // ================================
      if (booking.status === "waiting list" && booking.startDate) {
        const start = new Date(booking.startDate);

        const waitingDays = Math.ceil(
          (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (waitingDays < 0) {
          await booking.update({ status: "expired" });
          bookingDebug.actions.push("status updated to expired");
          console.log(`Booking ${booking.id} expired (waitingDays passed)`);
        }
      }

      debugData.push(bookingDebug);
    }

    return {
      status: true,
      message: "Waiting list expiration check completed.",
      data: debugData,
    };
  } catch (error) {
    return {
      status: false,
      message: "Error updating booking stats.",
      error: error.message,
      data: debugData,
    };
  }
}

exports.getBookingById = async (id, adminId, superAdminId) => {
  // await updateBookingStats();
  console.log("==============================================");
  console.log("📘 [Service] getBookingById Started");
  console.log("🔍 Incoming Params:", { id, adminId, superAdminId });
  console.log("==============================================");

  const whereClause = { id };
  console.log("🧩 Step 1: Initial whereClause:", whereClause);

  try {
    // 🧭 Step 2: Auto-detect superAdminId if missing
    if (!superAdminId && adminId) {
      console.log("🧠 Auto-detecting superAdminId from Admin table...");
      const adminData = await Admin.findOne({
        where: { id: adminId },
        attributes: ["superAdminId"],
      });
      superAdminId = adminData?.superAdminId || adminId;
      console.log("🧠 Auto-detected superAdminId:", superAdminId);
    }

    // 🧩 Step 3: Access scope
    if (superAdminId === adminId) {
      console.log("🛡️ Step 3a: Super Admin detected — full access granted.");
    } else {
      whereClause.bookedBy = adminId;
      console.log(
        "👤 Step 3b: Normal Admin — restricted to bookedBy =",
        adminId
      );
    }

    console.log(
      "🚀 Step 4: Fetching booking from DB with whereClause:",
      whereClause
    );

    // 🔍 Step 5: Fetch booking with associations
    const booking = await Booking.findOne({
      where: whereClause,
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: false,
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              required: false,
              include: [
                { model: Venue, as: "venue", required: false },
              ],
            },
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
        },

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
            "superAdminId",
          ],
          required: false,
        },
      ],
    });

    if (!booking) {
      console.warn(
        "⚠️ Step 6: Booking not found or unauthorized:",
        whereClause
      );
      return { status: false, message: "Booking not found or not authorized." };
    }

    console.log("✅ Step 7: Booking fetched successfully:", booking.id);

    // 🧩 Step 8: Extract venue
    const venue =
      booking.students?.[0]?.classSchedule?.venue || null

    // 💳 Step 9: Fetch Payment Plan (from booking.paymentPlanId)
    let paymentPlans = [];
    if (booking.paymentPlanId) {
      console.log(
        "💳 Step 9: Fetching Payment Plan by booking.paymentPlanId:",
        booking.paymentPlanId
      );

      paymentPlans = await PaymentPlan.findAll({
        where: { id: booking.paymentPlanId },
        order: [["createdAt", "DESC"]],
      });
    }

    // 🧍 Step 10: Extract related data
    console.log(
      "👨‍👩‍👧 Step 10: Extracting related student/parent/emergency data..."
    );

    const students =
      booking.students?.map((s) => ({
        id: s.id,
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        medicalInformation: s.medicalInformation,
        age: s.age,
        gender: s.gender,
        classScheduleId: s.classScheduleId,
        // ✅ student-wise class schedule
        classSchedule: s.classSchedule
          ? {
            id: s.classSchedule.id,
            className: s.classSchedule.className,
            startTime: s.classSchedule.startTime,
            endTime: s.classSchedule.endTime,
            capacity: s.classSchedule.capacity,
          }
          : null,
      })) || [];

    const parents =
      booking.students
        ?.flatMap((s) => s.parents || [])
        .map((p) => ({
          id: p.id,
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        })) || [];

    const emergency =
      booking.students
        ?.flatMap((s) => s.emergencyContacts || [])
        .map((e) => ({
          id: e.id,
          emergencyFirstName: e.emergencyFirstName,
          emergencyLastName: e.emergencyLastName,
          emergencyPhoneNumber: e.emergencyPhoneNumber,
          emergencyRelation: e.emergencyRelation,
        })) || [];

    // 🧾 Step 11: Prepare response
    console.log("🧾 Step 11: Building response object...");

    const response = {
      id: booking.id,
      bookingId: booking.bookingId,
      paymentPlanId: booking.paymentPlanId,
      startDate: booking.startDate,
      serviceType: booking.serviceType,
      interest: booking.interest,
      bookedBy: booking.bookedByAdmin || null,
      venueId: booking.venueId,
      status: booking.status,
      bookingType: booking.bookingType,
      totalStudents: booking.totalStudents,
      source: booking.source,
      createdAt: booking.createdAt,
      venue,
      students,
      parents,
      emergency,
      paymentPlans,
    };

    console.log("✅ Step 12: Final response ready for booking ID:", booking.id);
    return {
      status: true,
      message: "Fetched booking details successfully.",
      data: response,
    };
  } catch (error) {
    console.error("❌ getBookingById Error:", error);
    return { status: false, message: error.message || "Internal server error" };
  }
};

exports.getWaitingList = async (filters = {}) => {
  // await updateBookingStats();
  try {
    const trialWhere = {};

    const statusFilter = filters.status
      ? Array.isArray(filters.status)
        ? filters.status
        : [filters.status]
      : ["waiting list", "expired"];
    console.log(statusFilter);

    if (filters.interest) trialWhere.interest = filters.interest;

    const adminWhere = {};
    // let allowedAdminIds = [];
    const allowedAdminIds = Array.isArray(filters.bookedBy)
      ? filters.bookedBy.map(Number).filter(Boolean)
      : [];

    if (!allowedAdminIds.length) {
      throw new Error("Access denied: no allowed admins");
    }
    if (filters.bookedBy) {
      // Ensure bookedBy is always an array
      const bookedByArray = Array.isArray(filters.bookedBy)
        ? filters.bookedBy
        : [filters.bookedBy];

      trialWhere.bookedBy = { [Op.in]: bookedByArray };
    }

    // ---- Date filters ----
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      trialWhere.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.lte]: end };
    }

    if (filters.startDate) {
      const start = new Date(filters.startDate + " 00:00:00");
      const end = new Date(filters.startDate + " 23:59:59");
      trialWhere.startDate = { [Op.between]: [start, end] };
    }

    const studentWhere = {};
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase().trim();

      studentWhere[Op.or] = [
        // Match by first name
        Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("students.studentFirstName")),
          { [Op.like]: `%${keyword}%` }
        ),
        // Match by last name
        Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("students.studentLastName")),
          { [Op.like]: `%${keyword}%` }
        ),
        // Match by full name (first + space + last)
        Sequelize.where(
          Sequelize.fn(
            "LOWER",
            Sequelize.fn(
              "CONCAT",
              Sequelize.col("students.studentFirstName"),
              " ",
              Sequelize.col("students.studentLastName")
            )
          ),
          { [Op.like]: `%${keyword}%` }
        ),
      ];
    }
    const whereClause = {
      [Op.and]: [
        Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("Booking.status")),
          { [Op.in]: statusFilter.map((s) => s.toLowerCase()) }
        ),

        // 🔐 FINAL ACCESS CONTROL
        {
          [Op.or]: [
            // Admin / Agent bookings
            {
              bookedBy: { [Op.in]: allowedAdminIds },
            },

            // Website bookings → venue owner
            {
              bookedBy: null,
              source: "website",
              "$students.classSchedule.venue.createdBy$": {
                [Op.in]: allowedAdminIds,
              },
            },
          ],
        },
      ],
    };

    const bookings = await Booking.findAll({
      order: [["id", "DESC"]],
      // where: whereClause,
      // // where: trialWhere,
      where: {
        ...trialWhere,
        ...whereClause,
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: !!filters.studentName,
          where: filters.studentName ? studentWhere : undefined,
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              required: false,
              include: [
                {
                  model: Venue,
                  as: "venue",
                  required: false,
                  where: filters.venueName
                    ? { name: { [Op.like]: `%${filters.venueName}%` } }
                    : undefined,
                },
              ],
            },
            {
              model: BookingParentMeta,
              as: "parents",
              required: false,
            },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
        },
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
          where: filters.bookedBy ? adminWhere : undefined,
        },
        {
          model: Admin,
          as: "assignedAgent",  // 👈 alias for the assigned agent
          attributes: ["id", "firstName", "lastName", "email", "roleId", "status"],
          required: false,
        },
      ],
    });

    // ---- Transform Data ----
    const parsedBookings = bookings.map((booking) => {
      const students =
        booking.students?.map((s) => ({
          studentFirstName: s.studentFirstName,
          studentLastName: s.studentLastName,
          dateOfBirth: s.dateOfBirth,
          age: s.age,
          gender: s.gender,
          medicalInformation: s.medicalInformation,
          interest: s.interest,
          classScheduleId: s.classScheduleId,
          // ✅ student-wise class schedule
          classSchedule: s.classSchedule
            ? {
              id: s.classSchedule.id,
              className: s.classSchedule.className,
              startTime: s.classSchedule.startTime,
              endTime: s.classSchedule.endTime,
            }
            : null,
        })) || [];

      const parents =
        booking.students?.flatMap(
          (s) =>
            s.parents?.map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            })) || []
        ) || [];

      const emergency =
        booking.students?.flatMap(
          (s) =>
            s.emergencyContacts?.map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            })) || []
        )[0] || null;
      // ---- Calculate waitingDays based on startDate ----
      let waitingDays = null;
      if (booking.startDate) {
        const start = new Date(booking.startDate);
        const now = new Date();
        waitingDays = Math.ceil(
          (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      const venue =
        booking.students?.[0]?.classSchedule?.venue || null;
      return {
        ...booking.dataValues,
        students,
        parents,
        emergency,
        // classSchedule: booking.classSchedule || null,
        venue,
        bookedByAdmin: booking.bookedByAdmin || null,
        assignedAgent: booking.assignedAgent || null, // 👈 agent info
        waitingDays,
      };
    });

    // ---- Extract unique Venues + Admins ----
    const venues = [];
    const bookedByAdmins = [];

    parsedBookings.forEach((b) => {
      if (b.venue && !venues.find((v) => v.id === b.venue.id)) {
        venues.push(b.venue);
      }
      if (
        b.bookedByAdmin &&
        !bookedByAdmins.find((a) => a.id === b.bookedByAdmin.id)
      ) {
        bookedByAdmins.push(b.bookedByAdmin);
      }
    });

    // ---- Stats Calculation ----

    const calculatePercentageChange = (current, previous) => {
      if (!previous || previous === 0) {
        return current > 0 ? 100 : 0;
      }
      return Math.round(((current - previous) / previous) * 100);
    };
    // const totalOnWaitingList = parsedBookings.length;

    const now = new Date();

    const currentYearStart = new Date(now.getFullYear(), 0, 1);
    const currentYearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const previousYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const previousYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);

    const currentYearBookings = parsedBookings.filter(
      b =>
        new Date(b.createdAt) >= currentYearStart &&
        new Date(b.createdAt) <= currentYearEnd
    );

    const previousYearBookings = parsedBookings.filter(
      b =>
        new Date(b.createdAt) >= previousYearStart &&
        new Date(b.createdAt) <= previousYearEnd
    );

    const getTopWithCount = (bookings, type) => {
      const counter = {};

      bookings.forEach(b => {
        let key = null;

        if (type === "admin" && b.bookedByAdmin) {
          key = `${b.bookedByAdmin.firstName} ${b.bookedByAdmin.lastName}`;
        }

        if (type === "venue" && b.venue) {
          key = b.venue.name;
        }

        if (key) {
          counter[key] = (counter[key] || 0) + 1;
        }
      });

      const sorted = Object.entries(counter).sort((a, b) => b[1] - a[1])[0];

      return sorted
        ? { name: sorted[0], count: sorted[1] }
        : { name: null, count: 0 };
    };
    const INTEREST_SCORE_MAP = {
      low: 1,
      medium: 2,
      high: 3,
    };

    const calculateWaitingStats = (bookings) => {
      const totalOnWaitingList = bookings.length;

      const allInterests = bookings
        .map(b => INTEREST_SCORE_MAP[b.interest?.toLowerCase()])
        .filter(v => typeof v === "number");

      const avgInterest =
        allInterests.length > 0
          ? Number(
            (
              allInterests.reduce((a, b) => a + b, 0) / allInterests.length
            ).toFixed(2)
          )
          : 0;

      const avgDaysWaiting =
        bookings.length > 0
          ? Math.round(
            bookings.reduce((sum, b) => {
              const created = new Date(b.createdAt);
              const today = new Date();
              return (
                sum +
                Math.floor(
                  (today.getTime() - created.getTime()) /
                  (1000 * 60 * 60 * 24)
                )
              );
            }, 0) / bookings.length
          )
          : 0;

      return {
        totalOnWaitingList,
        avgInterest,
        avgDaysWaiting,
      };
    };

    // Top Referrer (admin with most bookings)
    const adminCount = {};
    parsedBookings.forEach((b) => {
      if (b.bookedByAdmin) {
        const name = `${b.bookedByAdmin.firstName} ${b.bookedByAdmin.lastName}`;
        adminCount[name] = (adminCount[name] || 0) + 1;
      }
    });
    const topReferrer =
      Object.entries(adminCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Most Requested Venue
    const venueCount = {};
    parsedBookings.forEach((b) => {
      if (b.venue) {
        venueCount[b.venue.name] = (venueCount[b.venue.name] || 0) + 1;
      }
    });

    const mostRequestedVenue =
      Object.entries(venueCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const currentStats = calculateWaitingStats(currentYearBookings);
    const previousStats = calculateWaitingStats(previousYearBookings);
    const currentTopReferrer = getTopWithCount(currentYearBookings, "admin");
    const previousTopReferrer = getTopWithCount(previousYearBookings, "admin");

    const currentTopVenue = getTopWithCount(currentYearBookings, "venue");
    const previousTopVenue = getTopWithCount(previousYearBookings, "venue");

    const stats = {
      totalOnWaitingList: {
        totalOnWaitingList: currentStats.totalOnWaitingList,
        percentage: calculatePercentageChange(
          currentStats.totalOnWaitingList,
          previousStats.totalOnWaitingList
        ),
      },
      avgInterest: {
        avgInterest: currentStats.avgInterest,
        percentage: calculatePercentageChange(
          currentStats.avgInterest,
          previousStats.avgInterest
        ),
      },
      avgDaysWaiting: {
        avgDaysWaiting: currentStats.avgDaysWaiting,
        percentage: calculatePercentageChange(
          currentStats.avgDaysWaiting,
          previousStats.avgDaysWaiting
        ),
      },
      topReferrer: {
        name: currentTopReferrer.name,
        percentage: calculatePercentageChange(
          currentTopReferrer.count,
          previousTopReferrer.count
        ),
      },
      mostRequestedVenue: {
        name: currentTopVenue.name,
        percentage: calculatePercentageChange(
          currentTopVenue.count,
          previousTopVenue.count
        ),
      },

    };

    return {
      status: true,
      message: "Waiting list bookings fetched successfully.",
      data: {
        waitingList: parsedBookings,
        venue: venues,
        bookedByAdmins,
        stats,
      },
    };
  } catch (error) {
    console.error("❌ getWaitingList Error:", error);
    return {
      status: false,
      message: error.message || "Failed to fetch waiting list",
      data: {
        waitingList: [],
        venue: [],
        bookedByAdmins: [],
        stats,
      },
    };
  }
};

exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();

  try {
    let parentAdminId = null;
    const adminId = options?.adminId || null;
    const parentPortalAdminId = options?.parentAdminId || null;
    const leadId = options?.leadId || null;

    // ⭐⭐⭐ MOST IMPORTANT FIX
    if (parentPortalAdminId) {
      parentAdminId = parentPortalAdminId;
    }
    let source = "website";

    if (parentPortalAdminId) {
      source = "parent";
    } else if (adminId) {
      source = "admin";
    }

    let bookedBy = null;
    let bookingSource = "website";

    if (source === "admin") {
      bookedBy = adminId;
      bookingSource = null;
    }

    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted leadId:", leadId);
    }

    if (data.parents?.length > 0 && !parentAdminId) {
      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (!email) throw new Error("Parent email is required");

      const parentRole = await AdminRole.findOne({
        where: { role: "Parents" },
        transaction: t,
      });

      const hashedPassword = await bcrypt.hash("Synco123", 10);

      if (source === "admin") {

        const existingAdmin = await Admin.findOne({
          where: { email },
          transaction: t,
        });

        if (existingAdmin) {
          throw new Error("Parent with this email already exists.");
        }
        // 👨‍💼 Admin → always create new parent
        const admin = await Admin.create(
          {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
            // ✅ ADD THIS
            referralCode: generateReferralCode(),
          },
          { transaction: t }
        );
        parentAdminId = admin.id;
      } else {
        // 🌐 Website → findOrCreate
        const [admin, isCreated] = await Admin.findOrCreate({
          where: { email },
          defaults: {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
            // ✅ ADD THIS
            referralCode: generateReferralCode(),
          },
          transaction: t,
        });
        // 🛡️ Safety net (old parent but referralCode missing)
        if (!isCreated && !admin.referralCode) {
          admin.referralCode = generateReferralCode();
          await admin.save({ transaction });
        }
        parentAdminId = admin.id;
      }
    }

    // Step 1: Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        parentAdminId,
        bookingId: generateBookingId(12),
        leadId,
        serviceType: "weekly class trial",
        totalStudents: data.totalStudents,
        startDate: data.startDate,
        // classScheduleId: data.classScheduleId,
        bookingType: "waiting list",
        className: data.className,
        classTime: data.classTime,
        bookedBy,
        status: "waiting list",
        source: bookingSource, // ✅ correct as per admin/website
        interest: data.interest,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t }
    );
    // Step 2: Create Students
    const studentIds = [];
    for (const student of data.students || []) {
      const studentMeta = await BookingStudentMeta.create(
        {
          bookingTrialId: booking.id,
          classScheduleId: student.classScheduleId, // ✅ HERE
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
      studentIds.push(studentMeta);
    }

    // Step 3: Create Parent Records
    if (data.parents && data.parents.length > 0 && studentIds.length > 0) {
      const firstStudent = studentIds[0];

      for (const parent of data.parents) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email || !emailRegex.test(email)) {
          throw new Error(`Invalid or missing parent email: ${email}`);
        }

        // 🔍 Check duplicate email in BookingParentMeta
        const existingParent = await BookingParentMeta.findOne({
          where: { parentEmail: email },
          transaction: t,
        });

        if (existingParent) {
          throw new Error(
            `Parent with email ${email} already exists in booking records.`
          );
        }

        // ✅ Create BookingParentMeta
        await BookingParentMeta.create(
          {
            studentId: firstStudent.id,
            parentFirstName: parent.parentFirstName,
            parentLastName: parent.parentLastName,
            parentEmail: email,
            parentPhoneNumber: parent.parentPhoneNumber,
            relationToChild: parent.relationToChild,
            howDidYouHear: parent.howDidYouHear,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );
      }
    }

    // Step 4: Emergency Contact
    if (
      data.emergency &&
      data.emergency.emergencyFirstName &&
      data.emergency.emergencyPhoneNumber &&
      studentIds.length > 0
    ) {
      const firstStudent = studentIds[0];
      await BookingEmergencyMeta.create(
        {
          studentId: firstStudent.id,
          emergencyFirstName: data.emergency.emergencyFirstName,
          emergencyLastName: data.emergency.emergencyLastName || "",
          emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
          emergencyRelation: data.emergency.emergencyRelation || "",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
    }

    // Step 5: Commit
    await t.commit();

    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentIds[0]?.id,
        studentFirstName: studentIds[0]?.studentFirstName,
        studentLastName: studentIds[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createBooking Error:", error);
    return { status: false, message: error.message };
  }
};

/*
exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();

  try {
    let parentAdminId = null;
    const adminId = options?.adminId || null;
    const parentPortalAdminId = options?.parentAdminId || null;
    const leadId = options?.leadId || null;

    // ✅ FIXED SOURCE LOGIC
    let source = "website"; // default website
    if (parentPortalAdminId) {
      source = "parent";
    } else if (adminId) {
      source = "admin";
    }

    // ✅ bookedBy logic
    let bookedBy = null;
    let bookingSource = source; // keep original source for logic

    if (source === "admin") {
      bookedBy = adminId;      // admin who booked
      bookingSource = null;    // ✅ save NULL in DB instead of 'admin'
    }

    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted leadId:", leadId);
    }

    // 🔍 Fetch the actual class schedule record
    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
      transaction: t,
    });

    if (!classSchedule) {
      throw new Error("Invalid class schedule selected.");
    }

    let bookingStatus;
    let newCapacity = classSchedule.capacity;

    if (classSchedule.capacity === 0) {
      // ✅ Capacity is 0 → allow waiting list
      bookingStatus = "waiting list";
    } else {
      // ❌ Capacity is available → reject waiting list
      throw new Error(
        `Class has available seats (${classSchedule.capacity}). Cannot add to waiting list.`
      );
    }

    if (data.parents?.length > 0) {
      if (DEBUG)
        console.log("🔍 [DEBUG] Source is 'open'. Processing first parent...");

      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (DEBUG) console.log("🔍 [DEBUG] Extracted parent email:", email);

      if (!email) throw new Error("Parent email is required for open booking");

      // 🔍 Check duplicate email in Admin table
      const existingAdmin = await Admin.findOne({
        where: { email },
        transaction: t,
      });

      if (existingAdmin) {
        throw new Error(
          `Parent with email ${email} already exists as an admin.`
        );
      }

      const plainPassword = "Synco123";
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      if (DEBUG)
        console.log("🔍 [DEBUG] Generated hashed password for parent account");
      // 🔹 Fetch Parent role
      const parentRole = await AdminRole.findOne({
        where: { role: "Parents" },
        transaction: t,
      });
      if (!parentRole) {
        throw new Error("Parent role not found in admin_roles table");
      }

      // Admin portal → always create new parent
      if (source === "admin") {
        const admin = await Admin.create(
          {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
          },
          { transaction: t }
        );
        parentAdminId = admin.id;
      } else {
        // website/open booking → findOrCreate
        const [admin, created] = await Admin.findOrCreate({
          where: { email },
          defaults: {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
          },
          transaction: t,
        });
        parentAdminId = admin.id;
      }
    }

    // Step 1: Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        parentAdminId,
        bookingId: generateBookingId(12),
        leadId,
        serviceType: "weekly class trial",
        totalStudents: data.totalStudents,
        startDate: data.startDate,
        classScheduleId: data.classScheduleId,
        bookingType: bookingStatus === "waiting list" ? "waiting list" : "confirmed",
        className: data.className,
        classTime: data.classTime,
        bookedBy,
        status: bookingStatus,
        source: bookingSource, // ✅ correct as per admin/website
        interest: data.interest,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t }
    );
    // Step 2: Create Students
    const studentIds = [];
    for (const student of data.students || []) {
      const studentMeta = await BookingStudentMeta.create(
        {
          bookingTrialId: booking.id,
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
      studentIds.push(studentMeta);
    }

    // Step 3: Create Parent Records
    if (data.parents && data.parents.length > 0 && studentIds.length > 0) {
      const firstStudent = studentIds[0];

      for (const parent of data.parents) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email || !emailRegex.test(email)) {
          throw new Error(`Invalid or missing parent email: ${email}`);
        }

        // 🔍 Check duplicate email in BookingParentMeta
        const existingParent = await BookingParentMeta.findOne({
          where: { parentEmail: email },
          transaction: t,
        });

        if (existingParent) {
          throw new Error(
            `Parent with email ${email} already exists in booking records.`
          );
        }

        // ✅ Create BookingParentMeta
        await BookingParentMeta.create(
          {
            studentId: firstStudent.id,
            parentFirstName: parent.parentFirstName,
            parentLastName: parent.parentLastName,
            parentEmail: email,
            parentPhoneNumber: parent.parentPhoneNumber,
            relationToChild: parent.relationToChild,
            howDidYouHear: parent.howDidYouHear,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );
      }
    }

    // Step 4: Emergency Contact
    if (
      data.emergency &&
      data.emergency.emergencyFirstName &&
      data.emergency.emergencyPhoneNumber &&
      studentIds.length > 0
    ) {
      const firstStudent = studentIds[0];
      await BookingEmergencyMeta.create(
        {
          studentId: firstStudent.id,
          emergencyFirstName: data.emergency.emergencyFirstName,
          emergencyLastName: data.emergency.emergencyLastName || "",
          emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
          emergencyRelation: data.emergency.emergencyRelation || "",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
    }

    // Step 5: Update Class Capacity only if confirmed booking
    if (bookingStatus !== "waiting list") {
      await ClassSchedule.update({ capacity: newCapacity }, { transaction: t });
    }

    // Step 6: Commit
    await t.commit();

    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentIds[0]?.id,
        studentFirstName: studentIds[0]?.studentFirstName,
        studentLastName: studentIds[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createBooking Error:", error);
    return { status: false, message: error.message };
  }
};
*/
exports.updateBookingStudents = async (
  bookingId,
  studentsPayload,
  transaction
) => {
  const t = transaction || (await sequelize.transaction());
  let isNewTransaction = !transaction;

  try {
    // 🔹 Fetch booking with associations
    const booking = await Booking.findOne({
      where: { id: bookingId },
      include: [
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
      ],
      transaction: t,
    });

    if (!booking) {
      if (isNewTransaction) await t.rollback();
      return { status: false, message: "Booking not found" };
    }

    // 🔹 Update or create students, parents, emergency contacts
    let adminSynced = false; // 🔐 ensure admin updated once

    for (const student of studentsPayload) {
      let studentRecord;

      // 🔹 Student
      if (student.id) {
        studentRecord = booking.students.find((s) => s.id === student.id);
        if (!studentRecord) continue;

        [
          "studentFirstName",
          "studentLastName",
          "dateOfBirth",
          "age",
          "gender",
          "medicalInformation",
        ].forEach((field) => {
          if (student[field] !== undefined)
            studentRecord[field] = student[field];
        });

        await studentRecord.save({ transaction: t });
      } else {
        studentRecord = await BookingStudentMeta.create(
          { bookingId, ...student },
          { transaction: t }
        );
      }

      // 🔹 Parents
      if (Array.isArray(student.parents)) {
        for (let index = 0; index < student.parents.length; index++) {
          const parent = student.parents[index];
          const isFirstParent =
            index === 0 && booking.parentAdminId && !adminSynced;

          // 🔒 PRE-CHECK admin email uniqueness
          if (isFirstParent && parent.parentEmail) {
            const admin = await Admin.findByPk(booking.parentAdminId, {
              transaction: t,
              paranoid: false,
            });

            if (admin && parent.parentEmail !== admin.email) {
              const emailExists = await Admin.findOne({
                where: {
                  email: parent.parentEmail,
                  id: { [Op.ne]: admin.id },
                },
                transaction: t,
                paranoid: false,
              });

              if (emailExists) {
                throw new Error("This email is already in use");
              }
            }
          }

          // 🔹 Parent update / create
          let parentRecord;
          if (parent.id) {
            parentRecord = studentRecord.parents?.find(
              (p) => p.id === parent.id
            );

            if (parentRecord) {
              [
                "parentFirstName",
                "parentLastName",
                "parentEmail",
                "parentPhoneNumber",
                "relationToChild",
                "howDidYouHear",
              ].forEach((field) => {
                if (parent[field] !== undefined)
                  parentRecord[field] = parent[field];
              });

              await parentRecord.save({ transaction: t });
            }
          } else {
            parentRecord = await BookingParentMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...parent },
              { transaction: t }
            );
          }

          // 🔹 Sync FIRST parent → Admin (once)
          if (isFirstParent) {
            const admin = await Admin.findByPk(booking.parentAdminId, {
              transaction: t,
              paranoid: false,
            });

            if (admin) {
              if (parent.parentFirstName !== undefined)
                admin.firstName = parent.parentFirstName;

              if (parent.parentLastName !== undefined)
                admin.lastName = parent.parentLastName;

              if (parent.parentEmail !== undefined)
                admin.email = parent.parentEmail;

              if (parent.parentPhoneNumber !== undefined)
                admin.phoneNumber = parent.parentPhoneNumber;

              await admin.save({ transaction: t });
              adminSynced = true;
            }
          }
        }
      }

      // Emergency Contacts
      if (Array.isArray(student.emergencyContacts)) {
        for (const emergency of student.emergencyContacts) {
          if (emergency.id) {
            const emergencyRecord = studentRecord.emergencyContacts?.find(
              (e) => e.id === emergency.id
            );
            if (emergencyRecord) {
              [
                "emergencyFirstName",
                "emergencyLastName",
                "emergencyPhoneNumber",
                "emergencyRelation",
              ].forEach((field) => {
                if (emergency[field] !== undefined)
                  emergencyRecord[field] = emergency[field];
              });
              await emergencyRecord.save({ transaction: t });
            }
          } else {
            await BookingEmergencyMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...emergency },
              { transaction: t }
            );
          }
        }
      }
    }

    if (isNewTransaction) await t.commit();

    // 🔹 Prepare structured response
    const students =
      booking.students?.map((s) => ({
        studentId: s.id,
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    const parents =
      booking.students?.flatMap(
        (s) =>
          s.parents?.map((p) => ({
            parentId: p.id,
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || []
      ) || [];

    const emergencyContacts =
      booking.students?.flatMap(
        (s) =>
          s.emergencyContacts?.map((e) => ({
            emergencyId: e.id,
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || []
      ) || [];

    return {
      status: true,
      message: "Booking updated successfully",
      data: {
        bookingId: booking.id,
        status: booking.status,
        students,
        parents,
        emergencyContacts,
      },
    };
  } catch (error) {
    if (isNewTransaction) await t.rollback();
    console.error("❌ Service updateBookingStudents Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.sendAllEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Get all students for this booking
    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });
    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 3️⃣ Venue & Class info
    const venue = await Venue.findByPk(booking.venueId);
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);
    const venueName = venue?.venueName || venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const classTime =
      classSchedule?.classTime || classSchedule?.startTime || "TBA";
    const trialDate = booking.trialDate || booking.startDate;
    const additionalNote = booking.additionalNote || "";
    const status = booking.status || "active ";

    // 4️⃣ Email template
    const emailConfigResult = await getEmailConfig(
      "admin",
      "waiting-listing-sendEmail"
    );
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Get unique parents for all students
    const allParents = await BookingParentMeta.findAll({
      where: { studentId: studentMetas.map((s) => s.id) },
    });
    const parentsMap = {};
    for (const parent of allParents) {
      if (parent?.parentEmail) {
        parentsMap[parent.parentEmail] = parent;
      }
    }

    // 6️⃣ Build students list and table HTML
    const studentsList = studentMetas
      .map((s) => `${s.studentFirstName} ${s.studentLastName}`)
      .join(", ");
    const studentsTableRows = studentMetas
      .map(
        (s) => `
      <tr>
        <td style="padding:8px;">${s.studentFirstName} ${s.studentLastName}</td>
        <td style="padding:8px;">${s.className || className}</td>
        <td style="padding:8px;">${s.classTime || classTime}</td>
        <td style="padding:8px;">${trialDate}</td>
      </tr>
    `
      )
      .join("");

    // 7️⃣ Send email to each parent
    for (const parentEmail in parentsMap) {
      const parent = parentsMap[parentEmail];

      let noteHtml = "";
      if (additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      let finalHtml = htmlTemplate
        .replace(/{{parentName}}/g, parent.parentFirstName)
        .replace(/{{status}}/g, status)
        .replace(/{{studentsList}}/g, studentsList)
        .replace(/{{studentsTableRows}}/g, studentsTableRows)
        .replace(/{{venueName}}/g, venueName)
        .replace(/{{className}}/g, className)
        .replace(/{{classTime}}/g, classTime)
        .replace(/{{trialDate}}/g, trialDate)
        .replace(/{{additionalNoteSection}}/g, noteHtml)
        .replace(/{{appName}}/g, "Synco")
        .replace(
          /{{logoUrl}}/g,
          "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
        )
        .replace(/{{year}}/g, new Date().getFullYear());

      const recipient = [
        {
          name: `${parent.parentFirstName} ${parent.parentLastName}`,
          email: parent.parentEmail,
        },
      ];

      const sendResult = await sendEmail(emailConfig, {
        recipient,
        subject,
        htmlBody: finalHtml,
      });

      if (sendResult.status) {
        sentTo.push(parent.parentEmail);
      }
    }

    return {
      status: true,
      message: `Emails sent to ${sentTo.length} parents`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

// exports.removeWaitingList = async ({ bookingId, reason, notes }) => {
//   try {
//     // 1. Find the booking in waiting list
//     const booking = await Booking.findOne({
//       bookingType: {
//       [Op.in]: ["waiting list", "paid"],
//     },
//     });

//     if (!booking) {
//       return {
//         status: false,
//         message: "Waiting list booking not found.",
//       };
//     }

//     // 2. Update booking table -> status + bookingType
//     booking.status = "active";
//     booking.bookingType = "waiting list";
//     serviceType: "weekly class membership",
//       await booking.save();

//     // 3. Insert record in CancelBooking
//     await CancelBooking.create({
//       bookingId: booking.id,
//       bookingType: "removed",
//       removedReason: reason,
//       removedNotes: notes || null,
//       // removedBy, // optional: who removed
//     });

//     return {
//       status: true,
//       message: "Booking removed from waiting list successfully.",
//       data: {
//         bookingId: booking.id,
//         status: "removed",
//         serviceType: "weekly class trial",
//         bookingType: "removed",
//         removedReason: reason,
//         removedNotes: notes || null,
//       },
//     };
//   } catch (error) {
//     console.error("❌ removeWaitingList Error:", error.message);
//     return {
//       status: false,
//       message: error.message || "Failed to remove from waiting list",
//     };
//   }
// };

exports.removeWaitingList = async ({ bookingId, reason, notes }) => {
  try {
    console.log("🚀 [Service] removeWaitingList started:", {
      bookingId,
      reason,
      notes,
    });

    // 1️⃣ Find the booking
    const booking = await Booking.findOne({
      where: {
        id: bookingId,
        bookingType: { [Op.in]: ["waiting list", "paid"] },
      },
    });

    if (!booking) {
      return {
        status: false,
        message: "Waiting list booking not found.",
      };
    }

    // 2️⃣ Conditional updates based on bookingType
    if (booking.bookingType === "paid") {

      // ✅ fetch recurring payment for this booking
      const recurringPayment = await BookingPayment.findOne({
        where: {
          bookingId: booking.id,
          paymentCategory: "recurring",
        },
        order: [["createdAt", "DESC"]],
      });

      let nextStatus = "active";

      // ✅ if recurring exists AND cancelled → keep booking cancelled
      if (recurringPayment && recurringPayment.paymentStatus === "cancelled") {
        nextStatus = "cancelled";
      }

      await booking.update({
        status: nextStatus,
        serviceType: "weekly class membership",
      });

    } else {
      return {
        status: false,
        message: `Unsupported bookingType: ${booking.bookingType}`,
      };
    }

    // 3️⃣ Create CancelBooking record
    await CancelBooking.create({
      bookingId: booking.id,
      bookingType: "removed",
      removedReason: reason,
      removedNotes: notes || null,
    });

    // 4️⃣ Return success
    return {
      status: true,
      message: "Booking removed from waiting list successfully.",
      data: {
        bookingId: booking.id,
        bookingType: booking.bookingType,
        status: booking.status,
        serviceType: booking.serviceType,
        removedReason: reason,
        removedNotes: notes || null,
      },
    };
  } catch (error) {
    console.error("❌ [Service] removeWaitingList error:", error);
    return {
      status: false,
      message: error.message || "Failed to remove from waiting list",
    };
  }
};


exports.convertToMembership = async (data, options) => {
  const t = await sequelize.transaction();
  try {
    const adminId = options?.adminId || null;

    // Step 1: Update existing booking or create new one
    let booking;
    if (data.id) {
      booking = await Booking.findByPk(data.id, {
        include: [{ model: BookingStudentMeta, as: "students" }],
        transaction: t,
      });
      if (!booking) throw new Error("Booking not found with provided id");

      await booking.update(
        {
          totalStudents: data.totalStudents ?? booking.totalStudents,
          serviceType: "weekly class membership",
          startDate: data.startDate ?? booking.startDate,
          trialDate: null,
          bookingType: data.paymentPlanId ? "paid" : booking.bookingType,
          paymentPlanId: data.paymentPlanId ?? booking.paymentPlanId,
          status: data.paymentPlanId ? "active" : data.status ?? booking.status,
          bookedBy: adminId || booking.bookedBy,
        },
        { transaction: t }
      );
    } else {
      booking = await Booking.create(
        {
          venueId: data.venueId,
          bookingId: generateBookingId(12),
          totalStudents: data.totalStudents,
          serviceType: "weekly class membership",
          startDate: data.startDate,
          trialDate: null,
          bookingType: data.paymentPlanId ? "paid" : "waiting list",
          paymentPlanId: data.paymentPlanId || null,
          status: data.status || "active",
          bookedBy: adminId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
      booking.students = [];
    }

    // Step 2 & 3: Update or create students, link parents & emergency
    const studentRecords = [];
    let currentCount = booking.students.length || 0;

    for (const student of data.students || []) {
      let studentRecord;

      if (student.id) {
        studentRecord = booking.students.find((s) => s.id === student.id);
        if (studentRecord) {
          await studentRecord.update(
            {
              classScheduleId: student.classScheduleId,
              studentFirstName: student.studentFirstName,
              studentLastName: student.studentLastName,
              dateOfBirth: student.dateOfBirth,
              age: student.age,
              gender: student.gender,
              medicalInformation: student.medicalInformation || null,
            },
            { transaction: t }
          );
        }
      } else {
        // Create new student (limit 3)
        if (currentCount >= 3)
          throw new Error(
            "You cannot add more than 3 students in one booking."
          );

        studentRecord = await BookingStudentMeta.create(
          {
            bookingTrialId: booking.id,
            classScheduleId: student.classScheduleId,   // ✅ MUST
            studentFirstName: student.studentFirstName,
            studentLastName: student.studentLastName,
            dateOfBirth: student.dateOfBirth,
            age: student.age,
            gender: student.gender,
            medicalInformation: student.medicalInformation || null,
          },
          { transaction: t }
        );
        booking.students.push(studentRecord);
        currentCount++;
      }

      studentRecords.push(studentRecord);

      // Link parents to this student
      if (Array.isArray(data.parents)) {
        for (const parent of data.parents) {
          if (parent.id) {
            const existingParent = await BookingParentMeta.findByPk(parent.id, {
              transaction: t,
            });
            if (existingParent) {
              await existingParent.update(
                { ...parent, studentId: studentRecord.id },
                { transaction: t }
              );
            } else {
              await BookingParentMeta.create(
                { ...parent, studentId: studentRecord.id },
                { transaction: t }
              );
            }
          } else {
            await BookingParentMeta.create(
              { ...parent, studentId: studentRecord.id },
              { transaction: t }
            );
          }
        }
      }

      // Link emergency contact to this student
      if (data.emergency && Object.keys(data.emergency).length > 0) {
        const emergency = data.emergency;
        if (emergency.id) {
          const existingEmergency = await BookingEmergencyMeta.findByPk(
            emergency.id,
            { transaction: t }
          );
          if (existingEmergency) {
            await existingEmergency.update(
              { ...emergency, studentId: studentRecord.id },
              { transaction: t }
            );
          } else {
            await BookingEmergencyMeta.create(
              { ...emergency, studentId: studentRecord.id },
              { transaction: t }
            );
          }
        } else {
          await BookingEmergencyMeta.create(
            { ...emergency, studentId: studentRecord.id },
            { transaction: t }
          );
        }
      }
    }

    // Step 6: Update Class Capacity
    const scheduleMap = {};

    for (const s of studentRecords) {
      scheduleMap[s.classScheduleId] =
        (scheduleMap[s.classScheduleId] || 0) + 1;
    }

    for (const scheduleId of Object.keys(scheduleMap)) {
      const count = scheduleMap[scheduleId];

      const classSchedule = await ClassSchedule.findByPk(scheduleId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!classSchedule) throw new Error(`Schedule ${scheduleId} not found`);

      if (classSchedule.capacity < count)
        throw new Error(`Not enough capacity for schedule ${scheduleId}`);

      await classSchedule.update(
        { capacity: classSchedule.capacity - count },
        { transaction: t }
      );
    }
    await t.commit();

    // Step 5: Payment Handling (GoCardless / AccessPaysuite)
    /* ================= STARTER PACK FIRST ================= */

    console.log("🔥 ===== STARTER PACK FLOW START =====");

    const venueForStarter = await Venue.findByPk(data.venueId);

    console.log("🔥 booking venueId:", data.venueId);
    console.log("🔥 venue found:", !!venueForStarter);
    console.log("🔥 starterPack flag:", venueForStarter?.starterPack);

    if (!venueForStarter) {
      throw new Error("Venue not found");
    }

    /* ✅ ONLY charge when explicitly enabled */
    const isStarterPackEnabled =
      venueForStarter.starterPack === true ||
      venueForStarter.starterPack === 1 ||
      venueForStarter.starterPack === "1";

    if (isStarterPackEnabled) {
      console.log("🔥 Starter pack enabled for venue");

      const starterPack = await StarterPack.findOne({
        where: { enabled: true },
        // transaction: t,
      });

      if (starterPack && Number(starterPack.price) > 0) {
        const parent = data.parents?.[0];
        if (!parent) throw new Error("Parent required for starter pack");

        const stripeRes = await chargeStarterPack({
          name: `${parent.parentFirstName} ${parent.parentLastName}`,
          email: parent.parentEmail,
          starterPack,
        });

        if (!stripeRes?.status)
          throw new Error(stripeRes?.message || "Starter pack payment failed");

        await createBookingPayment({
          bookingId: booking.id,
          studentId: studentRecords[0]?.id,
          // ✅ ADD THESE
          firstName:
            data.payment?.firstName || data.parents?.[0]?.parentFirstName || "",
          lastName:
            data.payment?.lastName || data.parents?.[0]?.parentLastName || "",
          email: data.payment?.email || data.parents?.[0]?.parentEmail || "",
          parent,
          amount: starterPack.price,
          paymentType: "stripe",
          paymentCategory: "starter_pack",
          paymentStatus: "paid", // 🔥 ADD THIS
          gatewayResponse: stripeRes.raw,
          // transaction: t,
        });

        console.log("✅ Starter pack payment saved");
      }
    } else {
      console.log("⛔ Starter pack disabled — skipping charge");
    }

    console.log("🔥 ===== STARTER PACK FLOW END =====");

    // Payment processing (same as your logic but fixed typo and consistency)
    if (booking.paymentPlanId && data.payment?.paymentType) {
      const venue = await Venue.findByPk(data.venueId);
      const venueOwnerAdmin = await Admin.findByPk(venue.createdBy);
      const overrideToken = venueOwnerAdmin?.GC_FRANCHISE_TOKEN || null;
      // No switching
      const paymentType = data.payment?.paymentType || "bank";
      if (DEBUG) {
        console.log("Step 5: Start payment process, paymentType:", paymentType);
      }
      // const isHQVenue = !overrideToken;
      if (DEBUG)
        console.log("Step 5: Start payment process, paymentType:", paymentType);


      let paymentStatusFromGateway = "pending";
      const firstStudentId = studentRecords[0]?.id;

      try {
        const paymentPlan = booking.paymentPlanId
          ? await PaymentPlan.findByPk(booking.paymentPlanId, {})
          : null;

        // fetch this paymentPlanId duration and interval firstly
        if (!paymentPlan) {
          throw new Error("Payment Plan not found for this booking.");
        }

        // 🔹 Step 2: Extract duration & interval
        const planDuration = Number(paymentPlan.duration || 0); // e.g., 1, 3, 6, 12
        const planInterval = paymentPlan.interval || "Month"; // usually "month"

        // 🔹 Step 3: Check type of plan
        const isShortTerm = planDuration === 1 && planInterval === "Month";
        const isMembership = !isShortTerm;

        // 🔹 Step 4: Optional logging for debugging
        if (DEBUG) {
          console.log("PaymentPlan fetched:", paymentPlan.id);
          console.log("Duration:", planDuration, "Interval:", planInterval);
          console.log("Is short-term plan:", isShortTerm);
          console.log("Is membership plan:", isMembership);
        }

        // ✅ Fetch effective classScheduleId from first student
        let effectiveScheduleId = null;

        // Check if data.students array exists and has at least 1 student
        if (Array.isArray(data.students) && data.students.length > 0) {
          effectiveScheduleId = data.students[0].classScheduleId;
        }

        if (!effectiveScheduleId) {
          throw new Error("Cannot determine classScheduleId: No student found");
        }

        // Fetch the ClassSchedule
        const classSchedule = await ClassSchedule.findByPk(effectiveScheduleId);

        if (!classSchedule) {
          throw new Error(
            `ClassSchedule not found for ID: ${effectiveScheduleId}`,
          );
        }

        // Safely parse termIds (DB has JSON array string)
        let termIds = [];
        if (Array.isArray(classSchedule.termIds)) {
          termIds = classSchedule.termIds;
        } else if (typeof classSchedule.termIds === "string") {
          try {
            termIds = JSON.parse(classSchedule.termIds);
          } catch (err) {
            console.error(
              "Failed to parse classSchedule.termIds:",
              classSchedule.termIds,
            );
            termIds = [];
          }
        }

        // Fetch Terms
        const terms = await Term.findAll({
          where: { id: termIds || [] },
        });

        // Console all terms
        console.log("Fetched Terms for ClassSchedule:");
        console.log(JSON.stringify(terms, null, 2)); // Proper formatted output
        console.log("================================");

        console.log("========== TERMS SESSION CHECK ==========");

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const passedSessions = [];
        const upcomingSessions = [];

        let totalPassedSessions = 0;
        let totalUpcomingSessions = 0;
        let remainingLessons = 0;
        let proRataAmount = 0;

        terms.forEach((term) => {
          let sessions = [];

          if (typeof term.sessionsMap === "string") {
            try {
              sessions = JSON.parse(term.sessionsMap);
            } catch (err) {
              console.error("Failed to parse sessionsMap:", term.sessionsMap);
              sessions = [];
            }
          }

          sessions.forEach((session) => {
            const sessionDate = new Date(session.sessionDate);
            sessionDate.setHours(0, 0, 0, 0);

            if (sessionDate < today) {
              passedSessions.push(session);
            } else {
              upcomingSessions.push(session);
            }
          });

          // totalPassedSessions += passedSessions.length;
          // totalUpcomingSessions += upcomingSessions.length;

          console.log(`\n===== Term: ${term.termName} =====`);
          console.log("✅ Passed Sessions:", passedSessions);
          console.log("🕒 Upcoming Sessions:", upcomingSessions);
        });
        totalPassedSessions = passedSessions.length;
        totalUpcomingSessions = upcomingSessions.length;
        const monthlyClassCount = {};

        upcomingSessions.forEach((upcomingSession) => {
          const date = new Date(upcomingSession.sessionDate);

          const year = date.getFullYear();
          const month = date.getMonth() + 1;

          const key = year + "-" + (month < 10 ? "0" + month : month);

          if (!monthlyClassCount[key]) {
            monthlyClassCount[key] = {
              year: year,
              month: month,
              classCount: 0,
            };
          }

          monthlyClassCount[key].classCount++;
        });

        // ✅ Convert to array + sort by year then month
        const formattedMonthlyClassCount = Object.values(
          monthlyClassCount,
        ).sort((a, b) =>
          a.year === b.year ? a.month - b.month : a.year - b.year,
        );

        const startDate = new Date(data.startDate);
        startDate.setHours(0, 0, 0, 0);

        const allSessions = upcomingSessions
          .map(s => {
            const d = new Date(s.sessionDate);
            d.setHours(0, 0, 0, 0);
            return d;
          })
          .sort((a, b) => a - b);

        const selectedMonth = startDate.getMonth();
        const selectedYear = startDate.getFullYear();

        const monthSessions = allSessions.filter(
          d => d.getMonth() === selectedMonth && d.getFullYear() === selectedYear
        );

        const remainingSessions = monthSessions.filter(d => d >= startDate);

        remainingLessons = remainingSessions.length;
        proRataAmount = remainingLessons * paymentPlan.priceLesson;

        const firstSessionOfMonth = monthSessions[0];

        if (firstSessionOfMonth && startDate.getTime() === firstSessionOfMonth.getTime()) {
          remainingLessons = 0;
          proRataAmount = 0;
        }


        console.log("\n========== SUMMARY ==========");
        console.log("Total Passed Sessions:", totalPassedSessions);
        console.log("Total Upcoming Sessions:", totalUpcomingSessions);
        console.log(`monthlyClassCount - `, formattedMonthlyClassCount);
        console.log("================================");

        if (!formattedMonthlyClassCount.length) {
          throw new Error("No upcoming sessions found");
        }

        const firstPaymentMonth = formattedMonthlyClassCount[0].month;
        const firstPaymentYear = formattedMonthlyClassCount[0].year;
        const firstPaymentAmount =
          paymentPlan.priceLesson * formattedMonthlyClassCount[0].classCount;

        console.log(
          `First payment will be for month: ${firstPaymentMonth}, year: ${firstPaymentYear}, amount: ${firstPaymentAmount}`,
        );

        console.log("🔥 Calculated Pro-Rata:", proRataAmount);

        const recurringAmount = firstPaymentAmount;

        const proRataTotal = Number(data?.payment?.proRataAmount ?? 0);

        // ✅ Step 2: frontend should send price only
        const expectedTotal = recurringAmount + proRataTotal;

        // console.log("FRONTEND PRICE:", frontendPrice);
        console.log("EXPECTED TOTAL:", expectedTotal);
        console.log("Recurring:", recurringAmount);
        console.log("ProRata:", proRataTotal);
        console.log("✅ Frontend total matches backend calculation");

        const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;

        let gatewayResponse = null;
        let goCardlessCustomer = null;
        let goCardlessBankAccount = null;
        let goCardlessBillingRequest = null;
        let recurringContractRes = null;
        let recurringContractId = null;
        let recurringDirectDebitRef = null;

        if (paymentType === "bank") {
          let gcCustomer = null;
          let gcBankAccount = null;
          let mandateId = null;

          try {
            // ================= Step 1: Create Customer + Bank Account =================
            const customerPayload = {
              email: data.payment.email || data.parents?.[0]?.parentEmail || "",
              given_name:
                data.payment.firstName || data.parents?.[0]?.parentFirstName,
              family_name:
                data.payment.lastName || data.parents?.[0]?.parentLastName,
              address_line1: data.payment.addressLine1 || "",
              city: data.payment.city || "",
              postal_code: data.payment.postalCode || "",
              country_code: data.payment.countryCode || "GB",
              account_holder_name: data.payment.account_holder_name || "",
              account_number: data.payment.account_number || "",
              branch_code: data.payment.branch_code || "",
            };

            const createCustomerRes = await createCustomer(
              customerPayload,
              overrideToken,
            );
            console.log(
              "🔹 Using GoCardless token (first 10 chars):",
              overrideToken || "None",
            );
            if (!createCustomerRes?.status || !createCustomerRes?.customer) {
              throw new Error(
                `Failed to create GoCardless customer: ${createCustomerRes?.message || "No customer returned"}`,
              );
            }

            gcCustomer = createCustomerRes.customer;

            if (!createCustomerRes?.bankAccount) {
              throw new Error("GoCardless bank account creation failed");
            }

            gcBankAccount = createCustomerRes.bankAccount;
            if (!gcBankAccount?.id) {
              throw new Error(
                "GoCardless bank account creation failed: ID missing",
              );
            }

            const createMandateRes = await createMandate(
              {
                customerBankAccountId: gcBankAccount.id,
                contract: { bookingId: booking.bookingId }, // number or string works now
                scheme: "bacs",
              },
              overrideToken,
            );
            if (createMandateRes?.mandate?.status === "pending_submission") {
              paymentStatusFromGateway = "processing";
            }

            if (createMandateRes?.mandate?.status === "submitted") {
              paymentStatusFromGateway = "contract_created";
            }

            if (createMandateRes?.mandate?.status === "active") {
              paymentStatusFromGateway = "active";
            }

            if (createMandateRes?.mandate?.status === "failed") {
              paymentStatusFromGateway = "failed";
            }

            if (!createMandateRes?.status || !createMandateRes?.mandate?.id) {
              throw new Error(
                `Failed to create GoCardless mandate: ${createMandateRes?.message || "No mandate returned"}`,
              );
            }

            mandateId = createMandateRes.mandate.id;
            console.log("✅ GoCardless mandate created:", mandateId);

            // ================= Step 2: ONE-OFF for First Month =================

            const termNotStarted = totalPassedSessions === 0;

            const firstMonthAmount = proRataTotal;


            // 🔥 Create ONE-OFF payment using createBillingRequest
            if (firstMonthAmount > 0) {
              console.log("🔥 Term started → Creating ONE-OFF via Direct Payment");

              const paymentPayload = {
                amount: firstMonthAmount, // in pence
                currency: "GBP",
                mandateId: mandateId,      // ✅ correct key
                description: `Pro-rata payment - ${classSchedule.className}`
              };

              console.log("💡 Creating Direct Payment with mandateId:", mandateId);


              const amountInPence = Math.round(firstMonthAmount * 100);

              console.log("💰 Amount in pence:", amountInPence);

              const paymentRes = await createPayment(
                {
                  amount: amountInPence,
                  currency: "GBP",
                  mandateId: mandateId,
                  description: `Pro-rata payment - ${classSchedule.className} | studentId: ${firstStudentId}`,
                },
                overrideToken
              );

              if (!paymentRes.status) {
                throw new Error(
                  `Failed to create GoCardless payment: ${paymentRes.message}`
                );
              }

              // Save payment in your DB
              await createBookingPayment({
                bookingId: booking.id,
                studentId: firstStudentId,
                parent: data.parents?.[0],

                firstName:
                  data.payment?.firstName || data.parents?.[0]?.parentFirstName || "",

                lastName:
                  data.payment?.lastName || data.parents?.[0]?.parentLastName || "",

                email:
                  data.payment?.email || data.parents?.[0]?.parentEmail || "",

                amount: firstMonthAmount,
                paymentType: "bank",
                paymentCategory: "pro_rata",
                paymentStatus: paymentRes.payment.status,
                gatewayResponse: paymentRes,
                currency: "GBP",
              });

              console.log("✅ First month ONE-OFF created via Direct Payment");
            }
            // 🔥 FULL PAYMENT FOR 1 MONTH PLAN
            // if (paymentPlan.duration === 1) {
            if (paymentPlan.duration === 1 && (!data.payment?.proRataAmount || data.payment.proRataAmount === 0)) {

              console.log("🔥 One month plan → creating single payment");

              const amountInPence = Math.round(recurringAmount * 100);

              const paymentRes = await createPayment(
                {
                  amount: amountInPence,
                  currency: "GBP",
                  mandateId: mandateId,
                  description: `Full payment - ${classSchedule.className}`,
                },
                overrideToken
              );

              if (!paymentRes.status) {
                throw new Error(`Payment failed: ${paymentRes.message}`);
              }

              await createBookingPayment({
                bookingId: booking.id,
                studentId: firstStudentId,
                firstName:
                  data.payment?.firstName || data.parents?.[0]?.parentFirstName,
                lastName:
                  data.payment?.lastName || data.parents?.[0]?.parentLastName,
                email:
                  data.payment?.email || data.parents?.[0]?.parentEmail,
                amount: recurringAmount,
                paymentType: "bank",
                paymentCategory: "full_payment",
                paymentStatus: paymentRes.payment.status,
                goCardlessMandateId: mandateId,
                goCardlessPaymentId: paymentRes.payment.id,
                gatewayResponse: paymentRes,
                // transaction: t
              });

              console.log("✅ One month payment saved");
            }

            // ================= Step 3: Subscription ONLY if duration > 1 =================

            if (paymentPlan.duration > 1) {
              console.log("🔥 Creating subscription for remaining months");

              let remainingMonths;

              if (termNotStarted) {
                // Term abhi start nahi hua
                remainingMonths = paymentPlan.duration;
                console.log("🔥 Full subscription:", remainingMonths);
              } else {
                // Term already started
                remainingMonths = paymentPlan.duration - 1;
                console.log("🔥 Remaining months:", remainingMonths);
              }

              const startDate = createMandateRes.mandate.next_possible_charge_date;
              const subscriptionPayload = {
                mandateId,
                amount: gbpToPence(recurringAmount),
                currency: "GBP",
                interval: 1,
                intervalUnit: "monthly",
                dayOfMonth: 1,
                count: remainingMonths,
                name: `Recurring Plan - ${classSchedule.className}`,
                start_date: startDate,
                // startDate: data.startDate, // 👈 ye hona chahiye
                // startDate: calculateContractStartDate(), // next month
                retryIfPossible: true,
                metadata: { bookingId: booking.id },
              };

              const subscriptionRes = await createSubscription(
                subscriptionPayload,
                overrideToken,
              );

              if (!subscriptionRes.status)
                throw new Error(subscriptionRes.message);
              console.log(
                "Subscription ID going to DB:",
                subscriptionRes.subscription.id,
              );
              await createBookingPayment({
                bookingId: booking.id,
                studentId: firstStudentId,
                parent: data.parents?.[0],
                // ✅ ADD THESE
                firstName:
                  data.payment?.firstName ||
                  data.parents?.[0]?.parentFirstName ||
                  "",
                lastName:
                  data.payment?.lastName ||
                  data.parents?.[0]?.parentLastName ||
                  "",
                email:
                  data.payment?.email || data.parents?.[0]?.parentEmail || "",
                amount: recurringAmount,
                paymentType: "bank",
                paymentCategory: "recurring",
                paymentStatus: paymentStatusFromGateway, // ✅ MUST ADD
                // ✅ ADD THESE TWO
                goCardlessMandateId: mandateId || null,

                goCardlessSubscriptionId:
                  subscriptionRes.subscription.id || null,
                gatewayResponse: {
                  goCardlessCustomer: gcCustomer,
                  goCardlessBankAccount: gcBankAccount,
                  goCardlessSubscription: subscriptionRes.subscription,
                },
              });

              console.log("✅ Subscription created for remaining months");
            } else {
              console.log("🔥 Duration = 1 → No subscription created");
            }
          } catch (err) {
            // if (gcCustomer?.id)
            //   await removeCustomer(gcCustomer.id, overrideToken);
            throw new Error(`GoCardless Payment Error: ${err.message}`);
          }
        } else if (paymentType === "accesspaysuite") {
          if (DEBUG) console.log("🔁 Processing Access PaySuite payment");

          // 1️⃣ GET SCHEDULE
          const schedulesRes = await getSchedules();

          if (!schedulesRes.status)
            throw new Error("Failed to fetch APS schedules");

          const services = schedulesRes.data?.Services || [];
          const schedules = services.flatMap((s) => s.Schedules || []);

          const matchedSchedule = findMatchingSchedule(schedules, paymentPlan);

          if (!matchedSchedule)
            throw new Error("AccessPaySuite schedule not found");

          /*
          =====================================
          2️⃣ CREATE CUSTOMER
          =====================================
           */

          const customerPayload = {
            email: data.payment?.email || data.parents?.[0]?.parentEmail,
            title: "Mr",
            customerRef: `CUS-${booking.id}-${Date.now()}`,
            firstName:
              data.payment?.firstName || data.parents?.[0]?.parentFirstName,
            surname:
              data.payment?.lastName || data.parents?.[0]?.parentLastName,
            accountNumber: data.payment?.account_number,
            bankSortCode: data.payment?.branch_code,
            accountHolderName:
              data.payment?.account_holder_name ||
              `${data.parents?.[0]?.parentFirstName} ${data.parents?.[0]?.parentLastName}`,
            line1: data.payment?.address_line1 || "Test Address",
            town: data.payment?.city || "London",
            postcode: data.payment?.postcode || "SW1A1AA",
            country: "GB",
          };

          const customerRes =
            await createAccessPaySuiteCustomer(customerPayload);

          if (!customerRes.status) throw new Error(customerRes.message);

          const customerId =
            customerRes.data?.CustomerId || customerRes.data?.Id;

          if (!customerId) throw new Error("APS: Customer ID missing");

          /*
          =====================================
          3️⃣ CREATE CONTRACT
           =====================================
          */

          const apsStartDate = getAPSNextPaymentDateFixed(0); // monthOffset = 0
          if (DEBUG) console.log("🔥 APS Contract Start Date (1st of month):", apsStartDate);
          const contractPayload = {
            ScheduleId: matchedSchedule.ScheduleId,
            Amount: recurringAmount,
            Start: apsStartDate,
            TerminationType: paymentPlan.duration ? "Fixed term" : "Until further notice",
          };

          if (paymentPlan.duration) {
            const start = new Date(apsStartDate);
            const end = new Date(start.getFullYear(), start.getMonth() + Number(paymentPlan.duration), 1);
            contractPayload.TerminationDate = formatDateLocal(end);
          }

          // Debug log
          console.log(
            "APS Contract Payload:",
            JSON.stringify(contractPayload, null, 2)
          );

          // Debug log
          console.log(
            "APS Contract Payload:",
            JSON.stringify(contractPayload, null, 2)
          );

          const contractRes = await createContract(customerId, contractPayload);

          if (!contractRes.status) {
            console.log("APS Error Response:", contractRes);
            throw new Error(contractRes.message || "APS Contract creation failed");
          }

          const contractId =
            contractRes.data?.contract?.Id || contractRes.data?.Id;

          const directDebitRef =
            contractRes.data?.contract?.DirectDebitRef ||
            contractRes.data?.DirectDebitRef;

          /*
          =====================================
          4️⃣ PRO-RATA PAYMENT
          =====================================
          */

          if (proRataTotal > 0) {
            if (DEBUG) console.log("🔥 APS PRO-RATA:", proRataTotal);

            const proRataRes = await createContractPayment(contractId, {
              amount: proRataTotal,
              date: startDate,
              description: `Pro-Rata - ${classSchedule.className}`,
              reference: `PR-${booking.id}-${Date.now()}`,
            });

            if (!proRataRes.status) throw new Error(proRataRes.message);

            await BookingPayment.create({
              bookingId: booking.id,
              paymentPlanId: booking.paymentPlanId,
              studentId: firstStudentId,
              firstName: data.payment?.firstName || data.parents?.[0]?.parentFirstName,
              lastName: data.payment?.lastName || data.parents?.[0]?.parentLastName,
              email: data.payment?.email || data.parents?.[0]?.parentEmail,
              merchantRef: proRataRes?.data?.Id,
              price: proRataTotal,
              paymentType: "accesspaysuite",
              paymentCategory: "pro_rata",
              amount: proRataTotal,
              currency: "GBP",
              paymentStatus: "pending",
              contractId,
              directDebitRef,
              gatewayResponse: proRataRes.data,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          /*
          =====================================
          5️⃣ ONE MONTH PLAN
          =====================================
          */

          if (paymentPlan.duration === 1 && proRataTotal === 0) {

            const fullRes = await createContractPayment(contractId, {
              amount: recurringAmount,
              date: startDate,
              description: `Full payment - ${classSchedule.className}`,
              reference: `FULL-${booking.id}-${Date.now()}`,
            });

            if (!fullRes.status) throw new Error(fullRes.message);

            await BookingPayment.create({
              bookingId: booking.id,
              paymentPlanId: booking.paymentPlanId,
              studentId: firstStudentId,
              firstName: data.payment?.firstName || data.parents?.[0]?.parentFirstName,
              lastName: data.payment?.lastName || data.parents?.[0]?.parentLastName,
              email: data.payment?.email || data.parents?.[0]?.parentEmail,

              merchantRef: fullRes?.data?.Id,

              price: recurringAmount,
              paymentType: "accesspaysuite",
              paymentCategory: "full_payment",
              amount: recurringAmount,
              currency: "GBP",
              paymentStatus: "pending",

              contractId,
              directDebitRef,
              gatewayResponse: fullRes.data,

              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          /*
          =====================================
         6️⃣ RECURRING MEMBERSHIP
         =====================================
          */
          if (paymentPlan.duration > 1) {

            const recurringMonths = proRataTotal > 0
              ? paymentPlan.duration - 1
              : paymentPlan.duration;

            for (let i = 0; i < recurringMonths; i++) {

              const paymentDate = new Date(startDate);
              paymentDate.setMonth(paymentDate.getMonth() + i + 1);

              const paymentRes = await createContractPayment(contractId, {
                amount: recurringAmount,
                date: paymentDate.toISOString().split("T")[0],
                description: `Month ${i + 1} - ${classSchedule.className}`,
                reference: `REC-${booking.id}-${i}-${Date.now()}`
              });

              if (!paymentRes.status) throw new Error(paymentRes.message);

              await BookingPayment.create({
                bookingId: booking.id,
                paymentPlanId: booking.paymentPlanId,
                studentId: firstStudentId,
                firstName: data.payment?.firstName || data.parents?.[0]?.parentFirstName,
                lastName: data.payment?.lastName || data.parents?.[0]?.parentLastName,
                email: data.payment?.email || data.parents?.[0]?.parentEmail,

                price: recurringAmount,
                amount: recurringAmount,
                currency: "GBP",

                paymentType: "accesspaysuite",
                paymentCategory: "recurring",
                paymentStatus: "pending",

                contractId,
                directDebitRef,
                merchantRef: paymentRes?.data?.Id,
                gatewayResponse: paymentRes.data,

                createdAt: new Date(),
                updatedAt: new Date(),
              });

            }

            if (DEBUG) console.log("✅ APS All recurring payments created");
          }

          // if (paymentPlan.duration > 1) {
          //   await BookingPayment.create({
          //     bookingId: booking.id,
          //     paymentPlanId: booking.paymentPlanId,
          //     studentId: firstStudentId,
          //     firstName: data.payment?.firstName || data.parents?.[0]?.parentFirstName,
          //     lastName: data.payment?.lastName || data.parents?.[0]?.parentLastName,
          //     email: data.payment?.email || data.parents?.[0]?.parentEmail,

          //     price: recurringAmount,

          //     paymentType: "accesspaysuite",
          //     paymentCategory: "recurring",
          //     amount: recurringAmount,
          //     currency: "GBP",
          //     paymentStatus: "pending",
          //     contractId,
          //     directDebitRef,
          //     gatewayResponse: contractRes.data,
          //     createdAt: new Date(),
          //     updatedAt: new Date(),
          //   });

          //   if (DEBUG) console.log("✅ APS Recurring membership saved");
          // }
        }

        if (paymentStatusFromGateway === "failed")
          throw new Error("Payment failed. Booking not created.");

        if (DEBUG) {
          console.log(
            "🔍 [DEBUG] Payment processed with status:",
            paymentStatusFromGateway,
          );
        }
      } catch (error) {
        if (!t.finished) await t.rollback();
        return { status: false, message: error.message };
      }
    }

    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentRecords[0]?.id,
        studentFirstName: studentRecords[0]?.studentFirstName,
        studentLastName: studentRecords[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};
