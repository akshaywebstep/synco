const {
  Booking,
  FreezeBooking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  BookingPayment,
  Term,
  ClassSchedule,
  Venue,
  PaymentPlan,
  Admin,
  AdminRole,
  CancelBooking,
  AppConfig,
  StarterPack,
} = require("../../../models");
const { sequelize } = require("../../../models");
const {
  createSchedule,
  getSchedules,
  createAccessPaySuiteCustomer,
  createContract,
  createOneOffPayment,
  createCustomerPayment,
  createContractPayment,
} = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const generateReferralCode = require("../../../utils/generateReferralCode");
const chargeStarterPack = require("../../../utils/payment/pay360/starterPackCharge");
const axios = require("axios");
const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const EPSILON = 0.01;
const {
  createCustomer,
  createBankAccount,
  removeCustomer,
} = require("../../../utils/payment/pay360/customer");
const {
  createBillingRequest,
  createPayment,
  createMandate,
  createSubscription,
  createOneOffPaymentGc,
  createOneOffPaymentGcViaApi,
} = require("../../../utils/payment/pay360/payment");

const gbpToPence = (amount) => Math.round(Number(amount) * 100);
const DEBUG = process.env.DEBUG === "true";

function safeJsonParse(value, label = "JSON") {
  if (!value) return {};

  try {
    let parsed = value;

    // First parse if string
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);

      // Handle double-stringified JSON
      if (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
      }
    }

    // Ensure object
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    console.error(`❌ Invalid ${label}`, error, value);
    return {};
  }
}

function generateBookingId(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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


function findMatchingSchedule(schedules) {
  if (!Array.isArray(schedules)) return null;

  return schedules.find(
    (s) => s.Name && s.Name.trim().toLowerCase() === "monthly",
  );
}
function validateUKBankDetails(accountNumber, sortCode) {
  if (!accountNumber || !/^\d{8}$/.test(accountNumber)) {
    return {
      status: false,
      message: "Invalid account number. It must be exactly 8 digits."
    };
  }

  // remove dashes if user sends 12-34-56
  const cleanedSortCode = sortCode ? sortCode.replace(/-/g, "") : "";

  if (!cleanedSortCode || !/^\d{6}$/.test(cleanedSortCode)) {
    return {
      status: false,
      message: "Invalid sort code. It must be exactly 6 digits."
    };
  }

  return {
    status: true,
    accountNumber,
    sortCode: cleanedSortCode
  };
}

async function autoSyncFreezeBilling() {
  const logs = [];

  try {
    const freezeBookings = await FreezeBooking.findAll({
      include: [
        {
          model: Booking,
          as: "booking", // 🔥 REQUIRED ALIAS FIX
          include: [
            {
              model: BookingPayment,
              as: "payments", // keep only if this alias exists
            },
          ],
        },
      ],
    });

    if (!freezeBookings.length) {
      return { status: true, message: "No freeze records to process" };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const freeze of freezeBookings) {
      const booking = freeze.booking;
      if (!booking) continue;

      const payment = booking.payments?.[0] || null;

      const freezeStart = new Date(freeze.freezeStartDate);
      const reactivateOn = new Date(freeze.reactivateOn);

      const actionLog = {
        bookingId: booking.id,
        actions: [],
      };

      /* -------- FREEZE -------- */
      if (freezeStart <= today && booking.status !== "frozen") {
        await booking.update({ status: "frozen" });
        actionLog.actions.push("booking → frozen");

        if (payment?.paymentType === "accesspaysuite") {
          const gateway =
            typeof payment.gatewayResponse === "string"
              ? JSON.parse(payment.gatewayResponse)
              : payment.gatewayResponse || {};

          await payment.update({
            paymentStatus: "paused",
            gatewayResponse: {
              ...gateway,
              freeze: {
                status: "frozen",
                from: freeze.freezeStartDate,
                reason: freeze.reasonForFreezing || null,
              },
            },
          });

          actionLog.actions.push("APS payment → paused");
        }
      }

      /* ------ REACTIVATE ------ */
      if (reactivateOn <= today) {
        await booking.update({ status: "active" });
        actionLog.actions.push("booking → active");

        if (payment?.paymentType === "accesspaysuite") {
          const gateway =
            typeof payment.gatewayResponse === "string"
              ? JSON.parse(payment.gatewayResponse)
              : payment.gatewayResponse || {};

          await payment.update({
            paymentStatus: "active",
            gatewayResponse: {
              ...gateway,
              freeze: {
                ...(gateway.freeze || {}),
                status: "reactivated",
                reactivatedOn: today,
              },
            },
          });

          actionLog.actions.push("APS payment → active");
        }

        await freeze.destroy();
        actionLog.actions.push("freeze record removed");
      }

      logs.push(actionLog);
    }

    return {
      status: true,
      message: "Auto-sync billing completed",
      data: logs,
    };
  } catch (error) {
    console.error("❌ autoSyncFreezeBilling error:", error);
    return {
      status: false,
      message: "Auto-sync failed",
      error: error.message,
    };
  }
}
// GBP → pence (GoCardless only)

// 🟢 Helper: create a payment row
async function createBookingPayment({
  bookingId,
  studentId,
  parent,
  firstName,
  lastName,
  email,
  dueDate,
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
    dueDate,
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

exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();
  try {

    let parentAdminId = null;
    const adminId = options?.adminId || null;
    const parentPortalAdminId = options?.parentAdminId || null;

    let source = "open"; // default = website

    // Parent portal MUST win
    if (parentPortalAdminId) {
      source = "parent";
    } else if (adminId) {
      source = "admin";
    }
    const leadId = options?.leadId || null;

    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted leadId:", leadId);
    }

    if (source === "parent") {
      // 👪 Parent portal → already logged in
      parentAdminId = parentPortalAdminId;
    } else if (data.parents?.length > 0) {
      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (!email) throw new Error("Parent email is required");

      const parentRole = await AdminRole.findOne({
        where: { role: "Parents" },
        transaction: t,
      });

      const hashedPassword = await bcrypt.hash("Synco123", 10);

      if (source === "admin") {
        // 👨‍💼 ADMIN → ALWAYS create new parent
        // 👨‍💼 ADMIN → Check duplicate email first
        const existingAdmin = await Admin.findOne({
          where: { email },
          transaction: t,
        });

        if (existingAdmin) {
          throw new Error("Parent with this email already exists.");
        }

        const admin = await Admin.create(
          {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
            referralCode: generateReferralCode(),
          },
          { transaction: t },
        );

        parentAdminId = admin.id;
      } else {
        // 🌐 WEBSITE → findOrCreate
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
          await admin.save({ transaction: t });
        }

        parentAdminId = admin.id;
      }
    }

    // 🔹 Determine bookedBy & source values
    let bookedBy = null;
    let bookingSource = null;

    if (source === "admin") {
      bookedBy = adminId; // ✅ admin who booked
      bookingSource = null;
    } else {
      bookedBy = null;
      bookingSource = "website";
    }
    // 🔹 BANK VALIDATION BEFORE BOOKING
    if (
      data.payment?.paymentType === "bank" ||
      data.payment?.paymentType === "accesspaysuite"
    ) {
      const accountNumber = data.payment?.account_number;
      const sortCode = data.payment?.branch_code;

      const validation = validateUKBankDetails(accountNumber, sortCode);

      if (!validation.status) {
        throw new Error(validation.message);
      }

      data.payment.account_number = validation.accountNumber;
      data.payment.branch_code = validation.sortCode;
    }

    // Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        // parentAdminId: parentAdminId,
        parentAdminId,
        bookingId: generateBookingId(12),
        leadId,
        totalStudents: data.totalStudents,
        classScheduleId: data.classScheduleId,
        startDate: data.startDate || null,
        serviceType: "weekly class membership",
        bookingType: data.paymentPlanId ? "paid" : "free",
        paymentPlanId: data.paymentPlanId || null,
        status: data.status || "active",
        bookedBy, // ✅ admin or null
        source: bookingSource, // ✅ website or null
        // bookedBy: source === "open" ? bookedByAdminId : adminId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t },
    );
    if (DEBUG) {
      console.log("✅ FINAL BOOKING VALUES", {
        parentAdminId,
        bookedBy,
        source: bookingSource,
      });
    }

    // Create Students
    const studentRecords = [];
    for (const student of data.students || []) {
      const studentMeta = await BookingStudentMeta.create(
        {
          bookingTrialId: booking.id, // renamed from bookingTrialId to bookingId
          classScheduleId: student.classScheduleId, // ✅ safe
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t },
      );
      studentRecords.push(studentMeta);
    }

    // Create Parents
    if (data.parents?.length && studentRecords.length) {
      const firstStudent = studentRecords[0];

      for (const parent of data.parents) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        if (!email) throw new Error("Parent email is required.");

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
          { transaction: t },
        );
      }
    }

    // Emergency Contact
    if (
      data.emergency?.emergencyFirstName &&
      data.emergency?.emergencyPhoneNumber &&
      studentRecords.length
    ) {
      const firstStudent = studentRecords[0];
      await BookingEmergencyMeta.create(
        {
          studentId: firstStudent.id,
          emergencyFirstName: data.emergency.emergencyFirstName,
          emergencyLastName: data.emergency.emergencyLastName,
          emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
          emergencyRelation: data.emergency.emergencyRelation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t },
      );
    }

    // Update Class Capacity
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
        { transaction: t },
      );
    }

    await t.commit();

    /* ================= STARTER PACK FIRST ================= */

    console.log("🔥 ===== STARTER PACK FLOW START =====");

    const venueForStarter = await Venue.findByPk(data.venueId);

    console.log("🔥 booking venueId:", data.venueId);
    console.log("🔥 venue found:", !!venueForStarter);
    console.log("🔥 starterPack flag:", venueForStarter?.starterPack);

    if (venueForStarter?.starterPack) {
      console.log("🔥 Starter pack enabled for venue");

      const parent = data.parents?.[0];
      if (!parent) {
        console.log("❌ Parent missing");
        throw new Error("Parent required for starter pack");
      }

      // ✅ Use frontend price directly
      const starterPackAmount = Number(data.starterPack || 0);

      if (starterPackAmount > 0) {
        console.log("🔥 Starter Pack Amount from frontend:", starterPackAmount);

        console.log("🔥 Calling chargeStarterPack...");
        const stripeRes = await chargeStarterPack({
          name: `${parent.parentFirstName} ${parent.parentLastName}`,
          email: parent.parentEmail,
          starterPack: { price: starterPackAmount }, // pass dynamic price
        });

        console.log("🔥 Stripe Response:", stripeRes);

        if (!stripeRes?.status) {
          console.log("❌ Stripe returned failure:", stripeRes?.message);
          throw new Error(stripeRes?.message || "Starter pack payment failed");
        }

        console.log("🔥 Stripe success, saving BookingPayment...");
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
          amount: starterPackAmount, // **dynamic from frontend**
          paymentType: "stripe",
          paymentCategory: "starter_pack",
          paymentStatus: "paid", // 🔥 ADD THIS
          gatewayResponse: stripeRes.raw,
          // transaction: t,
        });

        console.log("🔥 Starter pack payment saved successfully");
      } else {
        console.log("⚠️ Starter pack amount invalid or 0");
      }
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
          .map((s) => {
            const d = new Date(s.sessionDate);
            d.setHours(0, 0, 0, 0);
            return d;
          })
          .sort((a, b) => a - b);

        const selectedMonth = startDate.getMonth();
        const selectedYear = startDate.getFullYear();

        const monthSessions = allSessions.filter(
          (d) =>
            d.getMonth() === selectedMonth && d.getFullYear() === selectedYear,
        );

        const remainingSessions = monthSessions.filter((d) => d >= startDate);

        remainingLessons = remainingSessions.length;
        proRataAmount = remainingLessons * paymentPlan.priceLesson;

        const firstSessionOfMonth = monthSessions[0];

        if (
          firstSessionOfMonth &&
          startDate.getTime() === firstSessionOfMonth.getTime()
        ) {
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

        // 🔹 First Payment Date dynamically calculated
        const firstPaymentDate = new Date(firstPaymentYear, firstPaymentMonth - 1, 1); // 1st day of month
        const formattedFirstPaymentDate = formatDateLocal(firstPaymentDate);

        console.log("🔥 firstPaymentDate:", formattedFirstPaymentDate);

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
            // const frontendProRata = Number(data.payment?.proRataAmount || 0);

            const firstMonthAmount = proRataTotal;

            // 🔥 Create ONE-OFF payment using createBillingRequest
            if (firstMonthAmount > 0) {
              console.log(
                "🔥 Term started → Creating ONE-OFF via Direct Payment",
              );

              const paymentPayload = {
                amount: firstMonthAmount, // in pence
                currency: "GBP",
                mandateId: mandateId, // ✅ correct key
                description: `Pro-rata payment - ${classSchedule.className}`,
              };

              console.log(
                "💡 Creating Direct Payment with mandateId:",
                mandateId,
              );

              const amountInPence = Math.round(firstMonthAmount * 100);

              console.log("💰 Amount in pence:", amountInPence);

              const paymentRes = await createPayment(
                {
                  amount: amountInPence,
                  currency: "GBP",
                  mandateId: mandateId,
                  description: `Pro-rata payment - ${classSchedule.className} | studentId: ${firstStudentId}`,
                },
                overrideToken,
              );
              const merchantRef = paymentRes?.data?.Id;

              if (!paymentRes.status) {
                throw new Error(
                  `Failed to create GoCardless payment: ${paymentRes.message}`,
                );
              }
              const dueDate =
                paymentRes?.payment?.charge_date ||
                new Date();


              // Save payment in your DB
              await createBookingPayment({
                bookingId: booking.id,
                studentId: firstStudentId,
                parent: data.parents?.[0],
                firstName:
                  data.payment?.firstName || data.parents?.[0]?.parentFirstName,
                lastName:
                  data.payment?.lastName || data.parents?.[0]?.parentLastName,
                email: data.payment?.email || data.parents?.[0]?.parentEmail,
                amount: firstMonthAmount,
                merchantRef: merchantRef,
                goCardlessMandateId: mandateId,
                goCardlessPaymentId: paymentRes.payment.id, // ✅ save payment id
                paymentType: "bank",
                paymentCategory: "pro_rata",
                dueDate: dueDate,   // ✅ ADD THIS

                paymentStatus: paymentRes.payment.status,
                gatewayResponse: paymentRes,
                currency: "GBP",
              });

              console.log("✅ First month ONE-OFF created via Direct Payment");
            }
            // 🔥 FULL PAYMENT FOR 1 MONTH PLAN
            if (
              paymentPlan.duration === 1 &&
              (!data.payment?.proRataAmount || data.payment.proRataAmount === 0)
            ) {
              console.log("🔥 One month plan → creating single payment");

              const amountInPence = Math.round(recurringAmount * 100);

              const paymentRes = await createPayment(
                {
                  amount: amountInPence,
                  currency: "GBP",
                  mandateId: mandateId,
                  description: `Full payment - ${classSchedule.className}`,
                },
                overrideToken,
              );
              const merchantRef = paymentRes?.data?.Id;
              if (!paymentRes.status) {
                throw new Error(`Payment failed: ${paymentRes.message}`);
              }
              const dueDate =
                paymentRes?.payment?.charge_date ||
                new Date();
              await createBookingPayment({
                bookingId: booking.id,
                studentId: firstStudentId,
                firstName:
                  data.payment?.firstName || data.parents?.[0]?.parentFirstName,
                lastName:
                  data.payment?.lastName || data.parents?.[0]?.parentLastName,
                email: data.payment?.email || data.parents?.[0]?.parentEmail,
                merchantRef: merchantRef,
                amount: recurringAmount,
                paymentType: "bank",
                paymentCategory: "full_payment",
                dueDate: dueDate,   // ✅ ADD THIS
                paymentStatus: paymentRes.payment.status,
                goCardlessMandateId: mandateId,
                goCardlessPaymentId: paymentRes.payment.id,
                gatewayResponse: paymentRes,
                transaction: t,
              });

              console.log("✅ One month payment saved");
            }

            // ================= Step 3: Subscription ONLY if duration > 1 =================

            if (paymentPlan.duration > 1) {
              console.log("🔥 Creating subscription for remaining months");

              let remainingMonths;

              // 🔥 Correct condition
              if (proRataTotal > 0) {
                // Pro-rata already charged
                remainingMonths = paymentPlan.duration - 1;
                console.log("🔥 Pro-rata charged → remaining months:", remainingMonths);
              } else {
                // No pro-rata charged
                remainingMonths = paymentPlan.duration;
                console.log("🔥 No pro-rata → full subscription:", remainingMonths);
              }

              const startDate =
                createMandateRes.mandate.next_possible_charge_date;

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

              const upcomingPayments =
                subscriptionRes.subscription?.upcoming_payments || [];

              for (const payment of upcomingPayments) {

                const dueDate = payment.charge_date; // gateway date
                const amount = payment.amount / 100; // pence → GBP

                await createBookingPayment({
                  bookingId: booking.id,
                  studentId: firstStudentId,

                  firstName:
                    data.payment?.firstName ||
                    data.parents?.[0]?.parentFirstName ||
                    "",

                  lastName:
                    data.payment?.lastName ||
                    data.parents?.[0]?.parentLastName ||
                    "",

                  email:
                    data.payment?.email ||
                    data.parents?.[0]?.parentEmail ||
                    "",

                  amount: amount,
                  currency: "GBP",

                  paymentType: "bank",
                  paymentCategory: "recurring",
                  paymentStatus: paymentStatusFromGateway || "pending",

                  dueDate: dueDate, // ✅ gateway date save

                  goCardlessMandateId: mandateId,
                  goCardlessSubscriptionId: subscriptionRes.subscription.id,

                  gatewayResponse: {
                    goCardlessCustomer: gcCustomer,
                    goCardlessBankAccount: gcBankAccount,
                    goCardlessSubscription: subscriptionRes.subscription,
                  },
                });

              }

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

          // ✅ Dynamic contract start date
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
          // Save contract creation as a payment record (optional, if APS returns a due date here)
          if (contractRes.data?.DueDate) {
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
              paymentCategory: "contract",
              paymentStatus: "pending",
              contractId,
              directDebitRef,
              merchantRef: contractRes.data?.Id,
              dueDate: new Date(contractRes.data.DueDate),
              gatewayResponse: contractRes.data,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          /*
          =====================================
          4️⃣ PRO-RATA PAYMENT
          =====================================
          */

          if (proRataTotal > 0) {
            if (DEBUG) console.log("🔥 APS PRO-RATA:", proRataTotal);

            const proRataRes = await createContractPayment(contractId, {
              amount: proRataTotal,
              // date: startDate,
              date: apsStartDate,
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
              dueDate: new Date(proRataRes.data?.DueDate),
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
              // date: startDate,
              date: apsStartDate,
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
              dueDate: new Date(fullRes.data?.DueDate),
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
              // ✅ Always 1st of month
              const paymentDate = getAPSNextPaymentDateFixed(i + 1);

              const paymentRes = await createContractPayment(contractId, {
                amount: recurringAmount,
                date: paymentDate, // APS requires YYYY-MM-01
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
                dueDate: new Date(paymentRes.data?.DueDate),
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
    // await t.commit();
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

exports.getAllBookingsWithStats = async (filters = {}) => {
  await autoSyncFreezeBilling();

  try {
    if (filters.bookedBy !== undefined) {
      allowedAdminIds = Array.isArray(filters.bookedBy)
        ? filters.bookedBy.map(Number)
        : [Number(filters.bookedBy)];
    }
    // ----------------------------
    // ✅ ACCESS CONTROL
    // ----------------------------
    let accessControl = {};

    if (filters.bookedBy && filters.bookedBy.adminIds?.length > 0) {
      const { type, adminIds } = filters.bookedBy;

      // ------------------------------------
      // SUPER ADMIN
      // ------------------------------------
      if (type === "super_admin") {
        accessControl = {
          [Op.or]: [
            // 1️⃣ Admin bookings → self + child admins
            {
              bookedBy: { [Op.in]: adminIds },
            },

            // 2️⃣ Website bookings → ONLY venues created by THIS super admin
            {
              bookedBy: null,
              source: "website",
              "$students.classSchedule.venue.createdBy$": {
                [Op.in]: adminIds,
              },
            },
          ],
        };
      }

      // ------------------------------------
      // ADMIN
      // ------------------------------------
      else if (type === "admin") {
        accessControl = {
          [Op.or]: [
            // 1️⃣ Admin bookings → self + super admin
            {
              bookedBy: { [Op.in]: adminIds },
            },

            // 2️⃣ Website bookings → admin venues + super admin venues
            {
              bookedBy: null,
              source: "website",
              "$students.classSchedule.venue.createdBy$": {
                [Op.in]: adminIds,
              },
            },
          ],
        };
      }

      // ------------------------------------
      // AGENT
      // ------------------------------------
      else {
        accessControl = {
          bookedBy: { [Op.in]: adminIds },
        };
      }
    }
    // const whereBooking = { bookingType: "paid" };
    const whereBooking = {
      bookingType: {
        [Op.in]: ["paid", "waiting list", "removed"],
      },
      status: {
        [Op.in]: [
          "cancelled",
          "active",
          "frozen",
          "waiting list",
          "request_to_cancel",
          "rebooked",
          "removed",
          "attended",
          "not attended",
          "assigned",
        ],
      },

      [Op.and]: [
        // ✅ Waiting list rule
        {
          [Op.or]: [
            { status: { [Op.ne]: "waiting list" } },
            {
              status: "waiting list",
              paymentPlanId: { [Op.not]: null },
            },
          ],
        },

        // ✅ ACCESS CONTROL (admins + website bookings)
        accessControl,
      ],
    };

    const whereVenue = {};

    console.log(`filters - `, filters);
    if (filters.fromDate) filters.dateFrom = filters.fromDate;
    if (filters.toDate) filters.dateTo = filters.toDate;
    // 🔹 Filters
    // if (filters.status) whereBooking.status = filters.status;
    if (filters.status) {
      whereBooking.status = Array.isArray(filters.status)
        ? { [Op.in]: filters.status }
        : filters.status;
    }

    if (filters.venueId) whereBooking.venueId = filters.venueId;
    if (filters.venueName)
      whereVenue.name = { [Op.like]: `%${filters.venueName}%` };

    if (filters.duration) {
      const durations = Array.isArray(filters.duration)
        ? filters.duration
        : [filters.duration];

      const durationConditions = durations.map((d) => {
        const raw = d.toLowerCase().trim();
        const match = raw.match(/^(\d+)\s*(months?|weeks?|days?)$/);

        if (match) {
          const durationValue = match[1];
          const intervalValue = match[2];

          return {
            [Op.and]: [
              { "$paymentPlan.duration$": durationValue },
              { "$paymentPlan.interval$": { [Op.like]: `%${intervalValue}%` } },
            ],
          };
        }

        return {
          "$paymentPlan.duration$": { [Op.like]: `%${raw}%` },
        };
      });

      whereBooking[Op.or] = durationConditions;
    }

    // ✅ Date filters
    if (filters.fromDate) filters.dateFrom = filters.fromDate;
    if (filters.toDate) filters.dateTo = filters.toDate;

    // Date filters
    if (filters.dateBooked) {
      const start = new Date(`${filters.dateBooked} 00:00:00`);
      const end = new Date(`${filters.dateBooked} 23:59:59`);
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom && filters.dateTo) {
      const start = new Date(`${filters.dateFrom} 00:00:00`);
      const end = new Date(`${filters.dateTo} 23:59:59`);
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom) {
      const start = new Date(`${filters.dateFrom} 00:00:00`);
      whereBooking.createdAt = { [Op.gte]: start };
    } else if (filters.dateTo) {
      const end = new Date(`${filters.dateTo} 23:59:59`);
      whereBooking.createdAt = { [Op.lte]: end };
    }

    const bookings = await Booking.findAll({
      where: {
        ...whereBooking, // spread the filters correctly
        // serviceType: "weekly class membership",
        serviceType: {
          [Op.in]: ["weekly class membership", "weekly class trial"], // ✅ both types
        },
      },
      order: [["id", "DESC"]],
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              include: [
                {
                  model: Venue,
                  as: "venue",
                  where: filters.venueName
                    ? { name: { [Op.like]: `%${filters.venueName}%` } }
                    : undefined,
                  required: !!filters.venueName,
                },
              ],
            },
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
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
          model: Admin,
          as: "assignedAgent", // 👈 alias for the assigned agent
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
          ],
          required: false,
        },
      ],
    });

    const parsedBookings = await Promise.all(
      bookings.map(async (booking) => {
        // Students
        const students =
          booking.students?.map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
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

        // Parents (flatten all student parents)
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
              })) || [],
          ) || [];

        // Emergency contacts (take first one per student)
        // ✅ Pick only the first student's emergency contacts
        const emergency =
          booking.students?.[0]?.emergencyContacts?.map((e) => ({
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || [];

        // Venue & plan
        const venue = booking.students?.[0]?.classSchedule?.venue || null;

        const plan = booking.paymentPlan || null;

        const payment = booking.payments?.[0] || null;
        const paymentPlans = plan ? [plan] : [];

        // PaymentData with parsed gatewayResponse & transactionMeta
        const parsedGatewayResponse = safeJsonParse(
          payment?.gatewayResponse,
          "gatewayResponse",
        );

        const parsedTransactionMeta = safeJsonParse(
          payment?.transactionMeta,
          "transactionMeta",
        );

        const parsedGoCardlessBillingRequest = safeJsonParse(
          payment?.goCardlessBillingRequest,
          "goCardlessBillingRequest",
        );

        const paymentData = payment
          ? {
            id: payment.id,
            bookingId: payment.bookingId,
            firstName: payment.firstName,
            lastName: payment.lastName,
            email: payment.email,
            billingAddress: payment.billingAddress,
            cardHolderName: payment.cardHolderName,
            cv2: payment.cv2,
            expiryDate: payment.expiryDate,
            paymentType: payment.paymentType,
            // pan: payment.pan,
            paymentStatus: payment.paymentStatus,
            referenceId: payment.referenceId,
            currency: payment.currency,
            merchantRef: payment.merchantRef,
            description: payment.description,
            commerceType: payment.commerceType,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
            goCardlessBillingRequest: parsedGoCardlessBillingRequest,
            gatewayResponse: parsedGatewayResponse,
            transactionMeta: parsedTransactionMeta,
            totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
          }
          : null;

        const { venue: _venue, ...bookingData } = booking.dataValues;

        return {
          ...bookingData,
          students,
          parents,
          emergency,
          venue,
          // payments: booking.payments || [],
          paymentPlan: booking.paymentPlan || null,
          paymentPlans,
          paymentData,
          bookedByAdmin: booking.bookedByAdmin || null,
          assignedAgent: booking.assignedAgent || null, // 👈 agent info
        };
      }),
    );

    const allBookingsForStats = [...parsedBookings]; // ✅ ADD THIS

    // Student filter
    let finalBookings = parsedBookings;
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase().trim();
      finalBookings = finalBookings
        .map((b) => {
          const matchedStudents = b.students.filter((s) => {
            const firstName = s.studentFirstName?.toLowerCase() || "";
            const lastName = s.studentLastName?.toLowerCase() || "";
            const fullName = `${firstName} ${lastName}`.trim();

            return (
              firstName.includes(keyword) ||
              lastName.includes(keyword) ||
              fullName.includes(keyword)
            );
          });

          if (matchedStudents.length > 0) {
            return {
              ...b,
              students: matchedStudents,
            };
          }
          return null;
        })
        .filter(Boolean);

      if (finalBookings.length === 0) {
        return {
          status: true,
          message: "No bookings found for the student.",
          totalPaidBookings: 0,
          data: { membership: [], venue: [], bookedByAdmins: [] },
          stats: {
            totalStudents: 0,
            totalRevenue: 0,
            avgMonthlyFee: 0,
            avgLifeCycle: 0,
          },
        };
      }
    }

    // Venue filter
    if (filters.venueName) {
      const keyword = filters.venueName.toLowerCase();
      finalBookings = finalBookings.filter((b) =>
        b.venue?.name?.toLowerCase().includes(keyword),
      );
      if (finalBookings.length === 0) {
        return {
          status: true,
          message: "No bookings found for the venue.",
          totalPaidBookings: 0,
          data: { membership: [], venue: [], bookedByAdmins: [] },
          stats: {
            totalStudents: 0,
            totalRevenue: 0,
            avgMonthlyFee: 0,
            avgLifeCycle: 0,
          },
        };
      }
    }

    // Collect unique venues
    const venueMap = {};
    bookings.forEach((b) => {
      if (b.classSchedule?.venue) {
        venueMap[b.classSchedule.venue.id] = b.classSchedule.venue;
      }
    });
    const allVenues = Object.values(venueMap);

    // Collect unique bookedByAdmins
    const adminMap = {};
    bookings.forEach((b) => {
      if (b.bookedByAdmin) {
        adminMap[b.bookedByAdmin.id] = b.bookedByAdmin;
      }
    });
    const allAdmins = Object.values(adminMap);

    const calculatePercentageChange = (current, previous) => {
      if (!previous || previous === 0) {
        return current > 0 ? 100 : 0; // first-time growth
      }

      return Math.round(((current - previous) / previous) * 100);
    };

    const now = new Date();
    const currentYearStart = new Date(now.getFullYear(), 0, 1);
    const currentYearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const previousYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const previousYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    const currentYearBookings = allBookingsForStats.filter(
      (b) =>
        new Date(b.createdAt) >= currentYearStart &&
        new Date(b.createdAt) <= currentYearEnd,
    );

    const previousYearBookings = allBookingsForStats.filter(
      (b) =>
        new Date(b.createdAt) >= previousYearStart &&
        new Date(b.createdAt) <= previousYearEnd,
    );

    // Stats
    const calculateStats = (bookings) => {
      const totalStudents = bookings.reduce(
        (acc, b) => acc + (b.students?.length || 0),
        0,
      );

      const totalRevenue = bookings.reduce((acc, b) => {
        const plan = b.paymentPlans?.[0];
        if (plan?.price != null) {
          const studentsCount = b.students?.length || 1;
          return acc + (plan.price + (plan.joiningFee || 0)) * studentsCount;
        }
        return acc;
      }, 0);

      const avgMonthlyFee =
        bookings.reduce((acc, b) => {
          const plan = b.paymentPlans?.[0];
          if (plan?.duration && plan.price != null) {
            const studentsCount = b.students?.length || 1;
            return (
              acc +
              ((plan.price + (plan.joiningFee || 0)) / plan.duration) *
              studentsCount
            );
          }
          return acc;
        }, 0) / (totalStudents || 1);

      const avgLifeCycle =
        bookings.reduce((acc, b) => {
          const plan = b.paymentPlans?.[0];
          if (plan?.duration != null) {
            const studentsCount = b.students?.length || 1;
            return acc + plan.duration * studentsCount;
          }
          return acc;
        }, 0) / (totalStudents || 1);

      return {
        totalStudents,
        totalRevenue,
        avgMonthlyFee: Math.round(avgMonthlyFee * 100) / 100,
        // avgLifeCycle: Math.round(avgLifeCycle * 100) / 100,
        avgLifeCycle: Math.round(avgLifeCycle)
      };
    };
    const currentStats = calculateStats(currentYearBookings);
    const previousStats = calculateStats(previousYearBookings);

    const stats = {
      totalStudents: {
        totalStudents: currentStats.totalStudents,
        percentage: calculatePercentageChange(
          currentStats.totalStudents,
          previousStats.totalStudents,
        ),
      },
      totalRevenue: {
        totalRevenue: Number(currentStats.totalRevenue.toFixed(2)),
        percentage: Number(
          calculatePercentageChange(
            currentStats.totalRevenue,
            previousStats.totalRevenue
          ).toFixed(2)
        ),
      },
      avgMonthlyFee: {
        avgMonthlyFee: currentStats.avgMonthlyFee,
        percentage: calculatePercentageChange(
          currentStats.avgMonthlyFee,
          previousStats.avgMonthlyFee,
        ),
      },
      avgLifeCycle: {
        avgLifeCycle: `${Math.round(currentStats.avgLifeCycle)} months`,
        percentage: calculatePercentageChange(
          currentStats.avgLifeCycle,
          previousStats.avgLifeCycle,
        ),
      },
    };

    // ✅ New: Fetch all venues from DB (including those with no bookings)
    // ✅ Collect venues only from filtered bookings (hierarchy safe)
    const venueMapFiltered = {};

    finalBookings.forEach((b) => {
      if (b.venue?.id) {
        venueMapFiltered[b.venue.id] = b.venue;
      }
    });

    const allowedVenues = Object.values(venueMapFiltered).sort((a, b) =>
      (a.name || "").localeCompare(b.name || ""),
    );

    return {
      status: true,
      message: "Paid bookings retrieved successfully",
      totalPaidBookings: finalBookings.length,
      data: {
        membership: finalBookings,
        venue: allowedVenues,
        allVenues: allowedVenues,
        bookedByAdmins: allAdmins, // ✅ unique list of admins like venues
      },
      stats,
    };
  } catch (error) {
    console.error("❌ getAllBookingsWithStats Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getActiveMembershipBookings = async (filters = {}) => {
  await autoSyncFreezeBilling();

  try {
    console.log("🔹 Service start: getActiveMembershipBookings");
    console.log("🔹 Filters received in service:", filters);

    // ✅ Default filter: active + paid bookings
    // const whereBooking = { bookingType: "paid", status: "active" };
    const whereBooking = {
      bookingType: "paid",
      status: filters.status || "active",
    };

    const whereVenue = {};

    // 🔹 Apply filters
    if (filters.venueId) whereBooking.venueId = filters.venueId;
    if (filters.venueName)
      whereVenue.name = { [Op.like]: `%${filters.venueName}%` };

    if (filters.duration) {
      const raw = filters.duration.toLowerCase().trim();

      const match = raw.match(/^(\d+)\s*(months?|weeks?|days?)$/);

      if (match) {
        const durationValue = match[1];
        const intervalValue = match[2];

        whereBooking["$paymentPlan.duration$"] = durationValue;
        whereBooking["$paymentPlan.interval$"] = {
          [Op.like]: `%${intervalValue}%`,
        };
      } else {
        whereBooking["$paymentPlan.duration$"] = {
          [Op.like]: `%${raw}%`,
        };
      }
    }

    if (filters.bookedBy) {
      // Ensure bookedBy is always an array
      const bookedByArray = Array.isArray(filters.bookedBy)
        ? filters.bookedBy
        : [filters.bookedBy];

      whereBooking.bookedBy = { [Op.in]: bookedByArray };
    }
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    }
    if (filters.planType) {
      whereBooking["$paymentPlan.duration$"] = {
        [Op.like]: `%${filters.planType}%`,
      };
    }

    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase().trim();

      // ✅ Handles first name, last name, or full name (e.g., "akshay kumar")
      whereBooking[Op.or] = [
        { "$students.studentFirstName$": { [Op.like]: `%${keyword}%` } },
        { "$students.studentLastName$": { [Op.like]: `%${keyword}%` } },
        {
          [Op.and]: [
            {
              "$students.studentFirstName$": {
                [Op.ne]: null,
              },
            },
            {
              "$students.studentLastName$": {
                [Op.ne]: null,
              },
            },
            sequelize.where(
              sequelize.fn(
                "LOWER",
                sequelize.fn(
                  "CONCAT",
                  sequelize.col("students.studentFirstName"),
                  " ",
                  sequelize.col("students.studentLastName"),
                ),
              ),
              {
                [Op.like]: `%${keyword}%`,
              },
            ),
          ],
        },
      ];
    }
    const now = new Date();
    const currentYearStart = new Date(now.getFullYear(), 0, 1);
    const currentYearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    // If no explicit date filter → default to current year
    if (!filters.fromDate && !filters.toDate && !filters.dateBooked) {
      whereBooking.createdAt = {
        [Op.between]: [currentYearStart, currentYearEnd],
      };
    }

    // ✅ Date filters
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom && filters.dateTo) {
      const start = new Date(filters.dateFrom + " 00:00:00");
      const end = new Date(filters.dateTo + " 23:59:59");
      whereBooking.startDate = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      whereBooking.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.lte]: end };
    }

    console.log("🔹 whereBooking:", whereBooking);

    // 🔹 Fetch bookings
    const bookings = await Booking.findAll({
      where: {
        ...whereBooking, // spread the filters correctly
        serviceType: "weekly class membership",
      },
      // where: whereBooking,
      order: [["id", "DESC"]],
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              // include: [
              //   {
              //     model: Venue, as: "venue", where: filters.venueName
              //       ? { name: { [Op.like]: `%${filters.venueName}%` } }
              //       : undefined,
              //     required: !!filters.venueName,
              //   },
              // ],
            },
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: true,
        },
        // ✅ YEH NAYA ADD KIYA
        {
          model: Venue,
          as: "venue",
          where: filters.venueName
            ? { name: { [Op.like]: `%${filters.venueName}%` } }
            : undefined,
          required: !!filters.venueName,
        },
        { model: BookingPayment, as: "payments", required: false },
        {
          model: PaymentPlan,
          as: "paymentPlan",
          required: false,
          attributes: [
            "id",
            "title",
            "price",
            "joiningFee",
            "duration",
            "interval",
          ],
        },
        { model: Admin, as: "admin", required: false },
      ],
    });

    console.log("🔹 Bookings fetched:", bookings.length);

    // 🔹 Map bookings to memberShipSales
    const memberShipSales = bookings.map((booking) => {
      // const venue = booking.classSchedule?.venue || {};
      // Get venue from the first student's classSchedule
      const venue = booking.venue || null;
      const payment = booking.payments?.[0] || {};
      const plan = booking.paymentPlan || null;

      // Students
      const students =
        booking.students?.map((student) => ({
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
          classScheduleId: student.classScheduleId,
          // ✅ student-wise class schedule
          classSchedule: student.classSchedule
            ? {
              id: student.classSchedule.id,
              className: student.classSchedule.className,
              startTime: student.classSchedule.startTime,
              endTime: student.classSchedule.endTime,
            }
            : null,
        })) || [];

      // Parents
      const parents =
        booking.students?.flatMap(
          (student) =>
            student.parents?.map((parent) => ({
              parentFirstName: parent.parentFirstName,
              parentLastName: parent.parentLastName,
              parentEmail: parent.parentEmail,
              parentPhoneNumber: parent.parentPhoneNumber,
              relationToChild: parent.relationToChild,
              howDidYouHear: parent.howDidYouHear,
            })) || [],
        ) || [];

      // Emergency
      const emergency =
        booking.students?.flatMap((student) =>
          student.emergencyContacts?.map((em) => ({
            emergencyFirstName: em.emergencyFirstName,
            emergencyLastName: em.emergencyLastName,
            emergencyPhoneNumber: em.emergencyPhoneNumber,
            emergencyRelation: em.emergencyRelation,
          })),
        )?.[0] || null;

      // Payment
      let parsedGatewayResponse = {};
      let parsedTransactionMeta = {};

      parsedGatewayResponse = safeJsonParse(
        payment?.gatewayResponse,
        "gatewayResponse",
      );

      parsedTransactionMeta = safeJsonParse(
        payment?.transactionMeta,
        "transactionMeta",
      );

      // Combine all payment info into a fully structured object
      const paymentData = payment
        ? {
          id: payment.id,
          bookingId: payment.bookingId,
          firstName: payment.firstName,
          lastName: payment.lastName,
          email: payment.email,
          billingAddress: payment.billingAddress,
          cardHolderName: payment.cardHolderName,
          cv2: payment.cv2,
          expiryDate: payment.expiryDate,
          paymentType: payment.paymentType,
          // pan: payment.pan,
          paymentStatus: payment.paymentStatus,
          referenceId: payment.referenceId,
          currency: payment.currency,
          merchantRef: payment.merchantRef,
          description: payment.description,
          commerceType: payment.commerceType,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          gatewayResponse: parsedGatewayResponse, // fully parsed JSON
          transactionMeta: parsedTransactionMeta, // fully parsed JSON
          totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
        }
        : null;

      return {
        bookingId: booking.id,
        status: booking.status,
        startDate: booking.startDate,
        dateBooked: booking.createdAt,
        venueId: booking.venueId,

        // Full classSchedule + venue
        // classSchedule: booking.classSchedule || null,
        // venue: venue || null,

        bookedBy: booking.admin
          ? {
            id: booking.admin.id,
            firstName: booking.admin.firstName,
            lastName: booking.admin.lastName,
            email: booking.admin.email,
            role: booking.admin.role,
          }
          : null,

        // totalStudents: students.length,
        students,
        parents,
        emergency,
        venue,

        paymentPlanData: plan
          ? {
            id: plan.id,
            title: plan.title,
            price: plan.price,
            joiningFee: plan.joiningFee,
            duration: plan.duration,
            interval: plan.interval,
          }
          : null,

        payment: paymentData,
      };
    });

    // -------------------------------
    // Collect all unique venues (from all students)
    // -------------------------------
    const venueMap = {};
    bookings.forEach((booking) => {
      if (booking.venue && booking.venue.id) {
        venueMap[booking.venue.id] = booking.venue;
      }
    });
    const allVenues = Object.values(venueMap);

    // -------------------------------
    // Collect all unique bookedByAdmins
    // -------------------------------
    const adminMap = {};
    bookings.forEach((b) => {
      if (b.admin) {
        adminMap[b.admin.id] = {
          id: b.admin.id,
          firstName: b.admin.firstName,
          lastName: b.admin.lastName,
          email: b.admin.email,
          role: b.admin.role,
        };
      }
    });
    const allAdmins = Object.values(adminMap);
    // -------------------------------
    // Previous YEAR Stats
    // -------------------------------
    const calcChange = (current, previousAvg) => {
      if (!previousAvg) return 0;
      return Math.round((current - previousAvg) * 100) / 100;
    };

    const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const prevYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);

    const prevBookings = await Booking.findAll({
      where: {
        ...whereBooking,
        serviceType: "weekly class membership",
        createdAt: {
          [Op.between]: [prevYearStart, prevYearEnd],
        },
      },
      include: [
        { model: BookingStudentMeta, as: "students", required: true },
        { model: PaymentPlan, as: "paymentPlan", required: false },
      ],
    });

    // -------------------------------
    // Stats Calculation
    // -------------------------------
    const totalSales = memberShipSales.length;

    const totalRevenue = memberShipSales.reduce((acc, b) => {
      const plan = b.paymentPlanData;
      if (plan && plan.price != null) {
        const studentsCount = b.students?.length || 1;
        return acc + (plan.price + (plan.joiningFee || 0)) * studentsCount;
      }
      return acc;
    }, 0);

    const avgMonthlyFeeRaw =
      memberShipSales.reduce((acc, b) => {
        const plan = b.paymentPlanData;
        if (plan && plan.duration && plan.price != null) {
          const studentsCount = b.students?.length || 1;
          const monthlyFee =
            (plan.price + (plan.joiningFee || 0)) / plan.duration;
          return acc + monthlyFee * studentsCount;
        }
        return acc;
      }, 0) / (totalSales || 1);

    // ✅ Round to 2 decimals
    const avgMonthlyFee = Math.round(avgMonthlyFeeRaw * 100) / 100;

    const topSaleAgent = memberShipSales.length > 0 ? 1 : 0; // placeholder
    const prevTotalSales = prevBookings.length;

    const prevTotalRevenue = prevBookings.reduce((acc, b) => {
      const plan = b.paymentPlan;
      if (plan && plan.price != null) {
        const studentsCount = b.students?.length || 1;
        return acc + (plan.price + (plan.joiningFee || 0)) * studentsCount;
      }
      return acc;
    }, 0);

    // 👇 YEARLY AVERAGE (not total)
    const prevRevenueAvg =
      prevTotalSales > 0
        ? Math.round((prevTotalRevenue / prevTotalSales) * 100) / 100
        : 0;

    const prevAvgMonthlyFeeRaw =
      prevBookings.reduce((acc, b) => {
        const plan = b.paymentPlan;
        if (plan && plan.duration && plan.price != null) {
          const studentsCount = b.students?.length || 1;
          return (
            acc +
            ((plan.price + (plan.joiningFee || 0)) / plan.duration) *
            studentsCount
          );
        }
        return acc;
      }, 0) / (prevTotalSales || 1);

    const prevAvgMonthlyFee = Math.round(prevAvgMonthlyFeeRaw * 100) / 100;

    const stats = {
      totalSales: {
        value: totalSales,
        change: calcChange(totalSales, prevTotalSales),
      },
      totalRevenue: {
        value: Number(totalRevenue.toFixed(2)),
        change: Number(calcChange(totalRevenue, prevTotalRevenue).toFixed(2)),
      },
      avgMonthlyFee: {
        value: avgMonthlyFee,
        change: calcChange(avgMonthlyFee, prevAvgMonthlyFee),
      },
      topSaleAgent: {
        value: topSaleAgent,
        change: totalSales,
      },
    };

    // -------------------------------
    // Final response
    // -------------------------------
    return {
      status: true,
      message: "Paid bookings retrieved successfully",
      data: {
        memberShipSales,
        venue: allVenues, // ✅ all unique venues
        bookedByAdmins: allAdmins, // ✅ all unique bookedByAdmins
      },
      stats,
    };
  } catch (error) {
    console.error("❌ getActiveMembershipBookings Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.sendActiveMemberSaleEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch main booking
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
    const startDate = booking.startDate;
    const additionalNote = booking.additionalNote || "";

    // 4️⃣ Email template
    const emailConfigResult = await getEmailConfig(
      "admin",
      "send-email-membership",
    );
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Build students block (all in one list)
    let studentsHtml = "<ul>";
    for (const s of studentMetas) {
      studentsHtml += `<li>${s.studentFirstName} ${s.studentLastName} (Age: ${s.age}, Gender: ${s.gender})</li>`;
    }
    studentsHtml += "</ul>";

    // 6️⃣ Get unique parents across all students
    const allParents = await BookingParentMeta.findAll({
      where: { studentId: studentMetas.map((s) => s.id) },
    });

    const parentsMap = {};
    for (const parent of allParents) {
      if (parent?.parentEmail) {
        parentsMap[parent.parentEmail] = parent;
      }
    }

    // 7️⃣ Send one email per parent with all students listed
    for (const parentEmail in parentsMap) {
      const parent = parentsMap[parentEmail];

      let noteHtml = "";
      if (additionalNote && additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      let finalHtml = htmlTemplate
        .replace(/{{parentName}}/g, parent.parentFirstName)
        .replace(/{{studentsList}}/g, studentsHtml)
        .replace(/{{status}}/g, booking.status)
        .replace(/{{venueName}}/g, venueName)
        .replace(/{{className}}/g, className)
        .replace(/{{classTime}}/g, classTime)
        .replace(/{{startDate}}/g, startDate)
        .replace(/{{additionalNoteSection}}/g, noteHtml)
        .replace(/{{appName}}/g, "Synco")
        .replace(
          /{{logoUrl}}/g,
          "https://webstepdev.com/demo/syncoUploads/syncoLogo.png",
        )
        .replace(
          /{{kidsPlaying}}/g,
          "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png",
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
    console.error("❌ sendActiveMemberSaleEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};
exports.transferClass = async (data, options) => {
  const t = await sequelize.transaction();
  try {
    const adminId = options?.adminId || null;

    // 1️⃣ Validate booking
    const booking = await Booking.findByPk(data.bookingId, { transaction: t });
    if (!booking) throw new Error("Booking not found.");

    // 2️⃣ Pre-validate ALL students & classes
    const classCapacityMap = {};

    for (const item of data.transfers) {
      const student = await BookingStudentMeta.findOne({
        where: {
          id: item.studentId,
          bookingTrialId: booking.id,
        },
        transaction: t,
      });
      if (!student) throw new Error(`Student ${item.studentId} not found.`);

      // 🔴 SAME CLASS VALIDATION
      if (student.classScheduleId === item.classScheduleId) {
        throw new Error(
          "This student is already enrolled in the selected class. Please choose a different class.",
        );
      }

      const newClass = await ClassSchedule.findByPk(item.classScheduleId, {
        transaction: t,
      });
      if (!newClass)
        throw new Error(`Class ${item.classScheduleId} not found.`);

      classCapacityMap[item.classScheduleId] =
        (classCapacityMap[item.classScheduleId] || 0) + 1;

      item._student = student;
      item._oldClassScheduleId = student.classScheduleId;
      item._newClass = newClass;
    }

    // 3️⃣ Capacity check (IMPORTANT)
    for (const classId in classCapacityMap) {
      const classData = await ClassSchedule.findByPk(classId, {
        transaction: t,
      });
      if (classData.capacity < classCapacityMap[classId]) {
        throw new Error(
          `Not enough slots in "${classData.className}". Required: ${classCapacityMap[classId]}`,
        );
      }
    }

    // 4️⃣ Perform transfers
    for (const item of data.transfers) {
      await item._student.update(
        {
          classScheduleId: item.classScheduleId,
          updatedAt: new Date(),
        },
        { transaction: t },
      );

      // Increase old class capacity
      if (item._oldClassScheduleId) {
        await ClassSchedule.increment(
          { capacity: 1 },
          { where: { id: item._oldClassScheduleId }, transaction: t },
        );
      }

      // Decrease new class capacity
      await ClassSchedule.decrement(
        { capacity: 1 },
        { where: { id: item.classScheduleId }, transaction: t },
      );

      // Log transfer reason
      await CancelBooking.create(
        {
          bookingId: booking.id,
          studentId: item.studentId,
          bookingType: "membership",
          transferReasonClass: item.transferReasonClass,
          createdBy: adminId,
        },
        { transaction: t },
      );
    }

    await t.commit();

    return {
      status: true,
      message: "Classes transferred successfully.",
      data: {
        bookingId: booking.id,
        transferredStudents: data.transfers.map((t) => ({
          studentId: t.studentId,
          newClassScheduleId: t.classScheduleId,
        })),
      },
    };
  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

// exports.transferClass = async (data, options) => {
//   const t = await sequelize.transaction();
//   try {
//     const adminId = options?.adminId || null;

//     // 🔹 Step 1: Find Booking
//     const booking = await Booking.findByPk(data.bookingId, { transaction: t });
//     if (!booking) throw new Error("Booking not found.");

//     // 🔹 Step 2: Validate new ClassSchedule
//     const newClassSchedule = await ClassSchedule.findByPk(
//       data.classScheduleId, // ✅ match your payload
//       { transaction: t }
//     );
//     if (!newClassSchedule) throw new Error("New class schedule not found.");

//     // 🔹 Step 3: Validate Venue
//     let newVenueId = data.venueId || newClassSchedule.venueId;
//     if (newVenueId) {
//       const newVenue = await Venue.findByPk(newVenueId, { transaction: t });
//       if (!newVenue) throw new Error("New venue not found.");
//     }

//     // 🔹 Step 4: Update Booking
//     booking.classScheduleId = data.classScheduleId;
//     booking.venueId = newVenueId;
//     booking.updatedAt = new Date();
//     await booking.save({ transaction: t });

//     // 🔹 Step 5: Upsert CancelBooking
//     const existingCancel = await CancelBooking.findOne({
//       where: { bookingId: booking.id, bookingType: "membership" },
//       transaction: t,
//     });

//     if (existingCancel) {
//       await existingCancel.update(
//         {
//           transferReasonClass: data.transferReasonClass,
//           updatedAt: new Date(),
//           createdBy: adminId,
//         },
//         { transaction: t }
//       );
//     } else {
//       await CancelBooking.create(
//         {
//           bookingId: booking.id,
//           bookingType: "membership",
//           transferReasonClass: data.transferReasonClass,
//           createdBy: adminId,
//         },
//         { transaction: t }
//       );
//     }

//     // 🔹 Step 6: Commit
//     await t.commit();

//     return {
//       status: true,
//       message: "Class transferred successfully.",
//       data: {
//         bookingId: booking.id,
//         classScheduleId: booking.classScheduleId,
//         venueId: booking.venueId,
//         transferReasonClass: data.transferReasonClass,
//       },
//     };
//   } catch (error) {
//     await t.rollback();
//     return { status: false, message: error.message };
//   }
// };

// exports.addToWaitingListService = async (data, adminId) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🚀 [Service] addToWaitingListService started", {
//       data,
//       adminId,
//     });

//     // 1️⃣ Fetch original booking with relations
//     const originalBooking = await Booking.findByPk(data.bookingId, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//         { model: BookingPayment, as: "payments" }, // payments under booking
//       ],
//       transaction: t,
//     });

//     if (!originalBooking) throw new Error("Invalid booking selected.");

//     // ✅ Only clone from paid + active bookings
//     if (
//       !(
//         originalBooking.bookingType === "paid" &&
//         originalBooking.status === "active"
//       )
//     ) {
//       throw new Error(
//         `Booking type=${originalBooking.bookingType}, status=${originalBooking.status}. Cannot add to waiting list.`
//       );
//     }

//     // Validate venue and class schedule
//     const venue = await Venue.findByPk(data.venueId, { transaction: t });
//     if (!venue) throw new Error("Venue is required.");

//     const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
//       transaction: t,
//     });
//     if (!classSchedule) throw new Error("Class schedule is required.");

//     // Prevent duplicate waiting list entries
//     const studentIds = originalBooking.students.map((s) => s.id);
//     const existingWaiting = await Booking.findOne({
//       where: { classScheduleId: data.classScheduleId, status: "waiting list" },
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           where: { id: studentIds },
//         },
//       ],
//       transaction: t,
//     });

//     if (existingWaiting)
//       throw new Error(
//         "One or more students already have a waiting list entry for this class."
//       );

//     // 2️⃣ Create new waiting list booking (clone paymentPlanId from originalBooking)
//     const waitingBooking = await Booking.create(
//       {
//         bookingId: generateBookingId(),
//         bookingType: "waiting list",
//         venueId: data.venueId,
//         classScheduleId: data.classScheduleId,
//         paymentPlanId: originalBooking.paymentPlanId || null, // clone value, keep null if original is null
//         startDate: data.startDate || null,
//         additionalNote: data.additionalNote || null,
//         bookedBy: adminId,
//         status: "waiting list",
//         totalStudents: originalBooking.totalStudents || 1,
//         interest: originalBooking.interest || "medium",
//         // keyInformation: originalBooking.keyInformation || null,
//       },
//       { transaction: t }
//     );

//     // 3️⃣ Clone payments (linked to booking)
//     for (const payment of originalBooking.payments || []) {
//       await BookingPayment.create(
//         {
//           bookingId: waitingBooking.id,
//           firstName: payment.firstName,
//           lastName: payment.lastName,
//           email: payment.email,
//           billingAddress: payment.billingAddress,
//           cardHolderName: payment.cardHolderName,
//           cv2: payment.cv2,
//           expiryDate: payment.expiryDate,
//           paymentType: payment.paymentType,
//           pan: payment.pan,
//           paymentStatus: payment.paymentStatus,
//           referenceId: payment.referenceId,
//           currency: payment.currency,
//           merchantRef: payment.merchantRef,
//           description: payment.description,
//           commerceType: payment.commerceType,
//           gatewayResponse: payment.gatewayResponse,
//           transactionMeta: payment.transactionMeta,
//         },
//         { transaction: t }
//       );
//     }

//     // 4️⃣ Clone students + parents + emergency contacts
//     for (const student of originalBooking.students) {
//       const newStudent = await BookingStudentMeta.create(
//         {
//           bookingTrialId: waitingBooking.id,
//           studentFirstName: student.studentFirstName,
//           studentLastName: student.studentLastName,
//           dateOfBirth: student.dateOfBirth,
//           age: student.age,
//           gender: student.gender,
//           medicalInformation: student.medicalInformation,
//         },
//         { transaction: t }
//       );

//       for (const parent of student.parents || []) {
//         await BookingParentMeta.create(
//           {
//             studentId: newStudent.id,
//             parentFirstName: parent.parentFirstName,
//             parentLastName: parent.parentLastName,
//             parentEmail: parent.parentEmail,
//             parentPhoneNumber: parent.parentPhoneNumber,
//             relationToChild: parent.relationToChild,
//             howDidYouHear: parent.howDidYouHear,
//           },
//           { transaction: t }
//         );
//       }

//       for (const emergency of student.emergencyContacts || []) {
//         await BookingEmergencyMeta.create(
//           {
//             studentId: newStudent.id,
//             emergencyFirstName: emergency.emergencyFirstName,
//             emergencyLastName: emergency.emergencyLastName,
//             emergencyPhoneNumber: emergency.emergencyPhoneNumber,
//             emergencyRelation: emergency.emergencyRelation,
//           },
//           { transaction: t }
//         );
//       }
//     }

//     // 5️⃣ Reload new booking with relations before commit
//     const finalBooking = await Booking.findByPk(waitingBooking.id, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//         { model: BookingPayment, as: "payments" },
//       ],
//       transaction: t,
//     });

//     // 6️⃣ Commit transaction
//     await t.commit();

//     // 7️⃣ Simplified response
//     const simplified = {
//       venueId: finalBooking.venueId,
//       classScheduleId: finalBooking.classScheduleId,
//       paymentPlanId: finalBooking.paymentPlanId,
//       startDate: finalBooking.startDate,
//       totalStudents: finalBooking.totalStudents,
//       // keyInformation: finalBooking.keyInformation,
//       students: finalBooking.students.map((s) => ({
//         studentFirstName: s.studentFirstName,
//         studentLastName: s.studentLastName,
//         dateOfBirth: s.dateOfBirth,
//         age: s.age,
//         gender: s.gender,
//         medicalInformation: s.medicalInformation,
//       })),
//       parents: finalBooking.students.flatMap((s) =>
//         (s.parents || []).map((p) => ({
//           parentFirstName: p.parentFirstName,
//           parentLastName: p.parentLastName,
//           parentEmail: p.parentEmail,
//           parentPhoneNumber: p.parentPhoneNumber,
//           relationToChild: p.relationToChild,
//           howDidYouHear: p.howDidYouHear,
//         }))
//       ),
//       emergency:
//         finalBooking.students
//           .flatMap((s) => s.emergencyContacts || [])
//           .map((e) => ({
//             emergencyFirstName: e.emergencyFirstName,
//             emergencyLastName: e.emergencyLastName,
//             emergencyPhoneNumber: e.emergencyPhoneNumber,
//             emergencyRelation: e.emergencyRelation,
//           }))[0] || null,
//     };

//     return {
//       status: true,
//       message: "Booking added to waiting list successfully.",
//       data: simplified,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ [Service] addToWaitingListService error:", error);
//     return {
//       status: false,
//       message: error.message || "Server error.",
//       data: null,
//     };
//   }
// };
// exports.addToWaitingListService = async (data, adminId) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🚀 [Service] addToWaitingListService (update existing)", {
//       data,
//       adminId,
//     });

//     // 1️⃣ Fetch the existing booking
//     const booking = await Booking.findByPk(data.bookingId, {
//       include: [
//         { model: BookingStudentMeta, as: "students" },
//         { model: BookingPayment, as: "payments" },
//       ],
//       transaction: t,
//     });

//     if (!booking) throw new Error("Invalid booking selected.");

//     // 2️⃣ Handle "request to cancel" case
//     if (booking.status === "request_to_cancel" || booking.status === "cancelled") {
//       // 🔹 Remove entry from cancel booking table
//       const existingCancel = await CancelBooking.findOne({
//         where: { bookingId: booking.id },
//         transaction: t,
//       });

//       if (existingCancel) {
//         await CancelBooking.destroy({
//           where: { bookingId: booking.id },
//           transaction: t,
//         });
//         console.log("🧹 Removed cancel booking entry for:", booking.id);
//       }

//       // ✅ Update booking to waiting list
//       await booking.update(
//         {
//           status: "waiting list",
//           serviceType: data.serviceType || "weekly class trial",
//           venueId: data.venueId,
//           classScheduleId: data.classScheduleId,
//           startDate: null, // ⬅️ Force reset startDate
//           additionalNote: data.additionalNote || booking.additionalNote,
//           paymentPlanId: data.paymentPlanId,
//           bookedBy: adminId,
//         },
//         { transaction: t }
//       );

//       await t.commit();
//       const updatedBooking = await Booking.findByPk(booking.id, {
//         include: [
//           {
//             model: BookingStudentMeta,
//             as: "students",
//             include: [
//               { model: BookingParentMeta, as: "parents" },
//               { model: BookingEmergencyMeta, as: "emergencyContacts" },
//             ],
//           },
//         ],
//       });

//       return {
//         status: true,
//         message: "Booking moved from cancellation to waiting list successfully.",
//         data: updatedBooking,
//       };
//     }

//     // 3️⃣ For normal cases (active/paid bookings)
//     if (!(booking.bookingType === "paid" && booking.status === "active")) {
//       throw new Error(
//         `Booking type=${booking.bookingType}, status=${booking.status}. Cannot move to waiting list.`
//       );
//     }

//     // 4️⃣ Validate venue and class schedule (optional)
//     const venue = await Venue.findByPk(data.venueId, { transaction: t });
//     if (!venue) throw new Error("Venue is required.");

//     const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
//       transaction: t,
//     });
//     if (!classSchedule) throw new Error("Class schedule is required.");

//     // 5️⃣ Delete existing payments
//     // if (booking.payments?.length) {
//     //   const paymentIds = booking.payments.map((p) => p.id);
//     //   await BookingPayment.destroy({
//     //     where: { id: paymentIds },
//     //     transaction: t,
//     //   });
//     // }

//     // 6️⃣ Update booking to waiting list
//     await booking.update(
//       {
//         bookingType: "waiting list",
//         status: "waiting list",
//         serviceType: data.serviceType || "weekly class trial",
//         venueId: data.venueId,
//         classScheduleId: data.classScheduleId,
//         paymentPlanId: data.paymentPlanId,
//         startDate: data.startDate || booking.startDate,
//         additionalNote: data.additionalNote || booking.additionalNote,
//         // paymentPlanId: null,
//         // updatedBy: adminId,
//       },
//       { transaction: t }
//     );

//     await t.commit();

//     // 7️⃣ Fetch updated booking
//     const updatedBooking = await Booking.findByPk(booking.id, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//       ],
//     });

//     return {
//       status: true,
//       message: "Booking moved to waiting list successfully.",
//       data: updatedBooking,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ [Service] addToWaitingListService error:", error);
//     return {
//       status: false,
//       message: error.message || "Server error.",
//       data: null,
//     };
//   }
// };

// exports.addToWaitingListService = async (data, adminId) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🚀 [Service] addToWaitingListService (simplified)", {
//       data,
//       adminId,
//     });

//     // 1️⃣ Fetch existing booking
//     const booking = await Booking.findByPk(data.bookingId, {
//       include: [
//         { model: BookingStudentMeta, as: "students" },
//         { model: BookingPayment, as: "payments" },
//       ],
//       transaction: t,
//     });

//     if (!booking) throw new Error("Invalid booking selected.");

//     // 2️⃣ Validate normal case (only allow active/paid bookings)
//     if (!(booking.bookingType === "paid" && booking.status === "active")) {
//       throw new Error(
//         `Booking type=${booking.bookingType}, status=${booking.status}. Cannot move to waiting list.`
//       );
//     }

//     // 3️⃣ Validate class schedule if provided
//     if (data.classScheduleId) {
//       const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
//         transaction: t,
//       });
//       if (!classSchedule) throw new Error("Class schedule is required.");
//     }

//     // 4️⃣ Only update required fields
//     const updateFields = {
//       status: "waiting list",
//       serviceType: "weekly class trial",
//       classScheduleId: data.classScheduleId || booking.classScheduleId,
//       additionalNote: data.additionalNote || booking.additionalNote,
//     };

//     // 5️⃣ Conditionally update startDate
//     if (data.preferedStartDate) {
//       updateFields.startDate = data.preferedStartDate;
//     } else if (data.startDate) {
//       updateFields.startDate = data.startDate;
//     }
//     // else do not touch booking.startDate

//     await booking.update(updateFields, { transaction: t });

//     await t.commit();

//     // 6️⃣ Fetch updated booking for return
//     const updatedBooking = await Booking.findByPk(booking.id, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//       ],
//     });

//     return {
//       status: true,
//       message: "Booking updated to waiting list successfully.",
//       data: updatedBooking,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ [Service] addToWaitingListService error:", error);
//     return {
//       status: false,
//       message: error.message || "Server error.",
//       data: null,
//     };
//   }
// };

exports.addToWaitingListService = async (data, adminId) => {
  const t = await sequelize.transaction();
  try {
    // 1️⃣ Fetch booking
    const booking = await Booking.findByPk(data.bookingId, {
      include: [{ model: BookingStudentMeta, as: "students" }],
      transaction: t,
    });

    if (!booking) throw new Error("Invalid booking selected.");

    const allowedStatuses = [
      "active",
      "cancelled",
      "request_to_cancel",
      "frozen",
    ];

    if (
      booking.bookingType !== "paid" ||
      !allowedStatuses.includes(booking.status)
    ) {
      throw new Error("Booking cannot be moved to waiting list.");
    }

    // 2️⃣ Validate students payload
    if (!Array.isArray(data.students) || !data.students.length) {
      throw new Error("At least one student is required.");
    }

    // 3️⃣ Validate EACH student + class
    for (const s of data.students) {
      if (!s.studentId || !s.classScheduleId) {
        throw new Error("studentId and classScheduleId are required.");
      }

      const student = await BookingStudentMeta.findOne({
        where: {
          id: s.studentId,
          bookingTrialId: booking.id,
        },
        transaction: t,
      });

      if (!student) {
        throw new Error(`Student ${s.studentId} not found in booking.`);
      }

      const classSchedule = await ClassSchedule.findByPk(s.classScheduleId, {
        transaction: t,
      });

      if (!classSchedule) {
        throw new Error(`Class schedule ${s.classScheduleId} not found.`);
      }
    }

    // 4️⃣ Update students (student-wise class)
    for (const s of data.students) {
      await BookingStudentMeta.update(
        {
          classScheduleId: s.classScheduleId,
          additionalNote: data.additionalNote,
          preferredStartDate: data.preferedStartDate || data.startDate,
        },
        {
          where: {
            id: s.studentId,
            bookingTrialId: booking.id,
          },
          transaction: t,
        },
      );
    }

    // 5️⃣ Update booking status ONLY
    await booking.update({ status: "waiting list" }, { transaction: t });

    await t.commit();

    // 6️⃣ Return updated booking
    const updatedBooking = await Booking.findByPk(booking.id, {
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
      ],
    });

    return {
      status: true,
      message: "Students added to waiting list successfully.",
      data: updatedBooking,
    };
  } catch (error) {
    await t.rollback();
    return {
      status: false,
      message: error.message,
      data: null,
    };
  }
};

exports.getWaitingList = async () => {
  try {
    const waitingListEntries = await WaitingList.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          include: [
            {
              model: BookingStudentMeta,
              as: "students",
              include: [
                { model: BookingParentMeta, as: "parents" },
                { model: BookingEmergencyMeta, as: "emergencyContacts" },
              ],
            },
          ],
        },
        { model: Venue, as: "venue" },
        { model: ClassSchedule, as: "classSchedule" },
      ],
      order: [["createdAt", "DESC"]],
    });

    const formattedData = waitingListEntries.map((entry) => {
      const booking = entry.booking;

      const students = booking.students.map((student) => ({
        studentFirstName: student.studentFirstName,
        studentLastName: student.studentLastName,
        dateOfBirth: student.dateOfBirth,
        age: student.age,
        gender: student.gender,
        medicalInformation: student.medicalInformation,
      }));

      const parents = booking.students.flatMap((student) =>
        student.parents.map((p) => ({
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        })),
      );

      const emergencyContactRaw =
        booking.students[0]?.emergencyContacts?.[0] || null;

      const emergency = emergencyContactRaw
        ? {
          emergencyFirstName: emergencyContactRaw.emergencyFirstName,
          emergencyLastName: emergencyContactRaw.emergencyLastName,
          emergencyPhoneNumber: emergencyContactRaw.emergencyPhoneNumber,
          emergencyRelation: emergencyContactRaw.emergencyRelation,
        }
        : null;

      return {
        id: entry.id,
        bookingId: booking.id, // <-- bookingId included
        venue: entry.venue,
        classSchedule: entry.classSchedule,

        students,
        parents,
        emergency,
      };
    });

    return {
      status: true,
      data: formattedData,
      message: "Waiting list retrieved successfully",
    };
  } catch (error) {
    console.error("❌ getWaitingList service error:", error);
    return { status: false, message: error.message };
  }
};

exports.getBookingsById = async (bookingId) => {
  try {
    const booking = await Booking.findOne({
      where: {
        id: bookingId,
        bookingType: { [Op.or]: ["waiting list", "paid", "removed"] }, // <-- both types
        // serviceType: "weekly class membership",
        serviceType: {
          [Op.in]: ["weekly class membership", "weekly class trial"], // ✅ both types
        },
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              required: false,
              include: [{ model: Venue, as: "venue", required: false }],
            },
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
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
          model: FreezeBooking,
          as: "freezeBooking",
          required: false,
        },
      ],
    });

    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // ✅ collect venueIds from student class schedules
    const venueIds = new Set();

    for (const student of booking.students || []) {
      if (student.classScheduleId) {
        const classSchedule = await ClassSchedule.findByPk(
          student.classScheduleId,
          { attributes: ["venueId"] },
        );

        if (classSchedule?.venueId) {
          venueIds.add(classSchedule.venueId);
        }
      }
    }

    // 🔎 fetch all class schedules from those venues
    let newClasses = [];

    if (venueIds.size > 0) {
      newClasses = await ClassSchedule.findAll({
        where: {
          venueId: [...venueIds],
        },
      });
    }
    let noCapacityClass = [];

    if (venueIds) {
      // 🔹 jisme capacity na ho
      noCapacityClass = newClasses.filter((cls) => cls.capacity <= 0);
    }
    // ✅ Parse booking as before
    const students =
      booking.students?.map((s) => ({
        id: s.id, // <-- DB id
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
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
            id: p.id, // <-- DB id
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || [],
      ) || [];

    const emergency =
      booking.students?.flatMap(
        (s) =>
          s.emergencyContacts?.map((e) => ({
            id: e.id, // <-- DB id
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || [],
      ) || [];

    // const venue = booking.classSchedule?.venue || null;
    const venue = booking.students?.[0]?.classSchedule?.venue || null;
    const plan = booking.paymentPlan || null;

    const payments =
      booking.payments?.map((p) => ({
        ...p.get({ plain: true }),
        gatewayResponse: (() => {
          try {
            return JSON.parse(p.gatewayResponse);
          } catch {
            return p.gatewayResponse;
          }
        })(),
        transactionMeta: (() => {
          try {
            return JSON.parse(p.transactionMeta);
          } catch {
            return p.transactionMeta;
          }
        })(),
        goCardlessBankAccount: (() => {
          try {
            return JSON.parse(p.goCardlessBankAccount);
          } catch {
            return p.goCardlessBankAccount;
          }
        })(),
      })) || [];

    const payment = payments[0] || null;

    const parsedBooking = {
      bookingId: booking.id,
      bookedId: booking.bookingId,
      freezeBooking: booking.freezeBooking,
      serviceType: booking.serviceType,
      status: booking.status,
      startDate: booking.startDate,
      dateBooked: booking.createdAt,

      students,
      parents,
      emergency,

      classSchedule: booking.classSchedule || null,
      venue,
      paymentPlan: plan,
      payments,

      paymentData: payment
        ? {
          firstName: payment.firstName,
          lastName: payment.lastName,
          email: payment.email,
          billingAddress: payment.billingAddress,
          paymentStatus: payment.paymentStatus,
          totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
        }
        : null,

      bookedByAdmin: booking.bookedByAdmin || null,
      newClasses,
      noCapacityClass,
    };

    return {
      status: true,
      message: "Paid booking retrieved successfully",
      totalPaidBookings: 1,
      data: parsedBooking,
    };
  } catch (error) {
    console.error("❌ getBookingsById Error:", error.message);
    return { status: false, message: error.message };
  }
};

/**
 * Retry a failed BookingPayment
 * @param {number} bookingPaymentId
 * @returns {object} { status, message, retryPaymentId?, paymentStatus?, paymentUrl? }
 */
exports.retryFailedPayment = async (bookingPaymentId) => {
  const t = await sequelize.transaction();

  try {
    // Step 1: Fetch the original payment
    const originalPayment = await BookingPayment.findByPk(bookingPaymentId, {
      transaction: t,
    });
    if (!originalPayment) throw new Error("BookingPayment not found");

    // Retry only if status is 'failed'
    if (originalPayment.paymentStatus !== "failed") {
      await t.commit();
      return {
        status: false,
        message: `Cannot retry payment. Current status is: ${originalPayment.paymentStatus}`,
      };
    }

    if (DEBUG)
      console.log("🔹 Retrying failed payment ID:", originalPayment.id);

    // Step 2: Fetch related booking
    const booking = await Booking.findByPk(originalPayment.bookingId, {
      transaction: t,
    });
    if (!booking) throw new Error("Booking not found");

    // Step 3: Determine payment type
    let paymentStatusFromGateway = "pending";
    let gatewayResponse = null;
    let paymentUrl = null;

    if (originalPayment.paymentType === "bank") {
      // GoCardless retry
      if (!originalPayment.goCardlessMandateId)
        throw new Error("Bank payment requires mandateId");

      const retryResult = await createOneOffPaymentGcViaApi({
        mandateId: originalPayment.goCardlessMandateId,
        amount: originalPayment.price, // use DB price column
        description: originalPayment.description || "Retry failed payment",
      });

      if (!retryResult.status)
        throw new Error(retryResult.message || "GoCardless retry failed");

      gatewayResponse = retryResult.gatewayResponse || retryResult.payment;
      paymentStatusFromGateway = retryResult.paymentStatus || "pending";
    } else if (originalPayment.paymentType === "accesspaysuite") {
      // AccessPaySuite retry placeholder
      gatewayResponse = { message: "AccessPaySuite retry not implemented yet" };
      paymentStatusFromGateway = "pending";
      paymentUrl = null;
    } else {
      throw new Error(
        `Unsupported paymentType: ${originalPayment.paymentType}`,
      );
    }

    // Step 4: Create new BookingPayment row
    const retryPayment = await BookingPayment.create(
      {
        bookingId: originalPayment.bookingId,
        studentId: originalPayment.studentId,
        paymentType: originalPayment.paymentType,
        referenceId: originalPayment.referenceId,
        paymentStatus: paymentStatusFromGateway,
        amount: originalPayment.amount,
        price: originalPayment.price,
        firstName: originalPayment.firstName,
        lastName: originalPayment.lastName,
        email: originalPayment.email,
        merchantRef: `TXN-${Math.floor(1000 + Math.random() * 9000)}`,
        description: originalPayment.description,
        gatewayResponse,
        goCardlessMandateId: originalPayment.goCardlessMandateId || null,
        goCardlessPaymentId: originalPayment.goCardlessPaymentId || null,
        goCardlessCustomer: originalPayment.goCardlessCustomer || null,
        goCardlessBankAccount: originalPayment.goCardlessBankAccount || null,
        goCardlessBillingRequest:
          originalPayment.goCardlessBillingRequest || null,
        contractId: originalPayment.contractId || null,
        directDebitRef: originalPayment.directDebitRef || null,
        transactionMeta: { status: paymentStatusFromGateway },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t },
    );

    if (DEBUG)
      console.log("✅ Retry BookingPayment created with ID:", retryPayment.id);

    await t.commit();

    return {
      status: true,
      message: `Retry completed with status: ${paymentStatusFromGateway}`,
      retryPaymentId: retryPayment.id,
      paymentStatus: paymentStatusFromGateway,
      paymentUrl,
    };
  } catch (error) {
    console.error("❌ retryFailedPayment error:", error.message);
    await t.rollback();
    return { status: false, message: error.message };
  }
};

exports.getFailedPaymentsByBookingId = async (bookingId) => {
  if (!bookingId) {
    throw new Error("Booking ID is required");
  }

  const failedPayments = await BookingPayment.findAll({
    where: {
      bookingId,
      paymentStatus: "failed", // Only failed payments
    },
    order: [["createdAt", "DESC"]],
  });

  // Parse gatewayResponse and transactionMeta
  const parsedPayments = failedPayments.map((payment) => {
    let gatewayResponse = payment.gatewayResponse;
    let transactionMeta = payment.transactionMeta;
    let goCardlessCustomer = payment.goCardlessCustomer;
    let goCardlessBankAccount = payment.goCardlessBankAccount;
    let goCardlessBillingRequest = payment.goCardlessBillingRequest;

    // Ensure JSON parsing if stored as string
    if (typeof gatewayResponse === "string") {
      try {
        gatewayResponse = JSON.parse(gatewayResponse);
      } catch (err) {
        console.error("Failed to parse gatewayResponse:", err.message);
      }
    }

    if (typeof transactionMeta === "string") {
      try {
        transactionMeta = JSON.parse(transactionMeta);
      } catch (err) {
        console.error("Failed to parse transactionMeta:", err.message);
      }
    }

    if (typeof goCardlessCustomer === "string") {
      try {
        goCardlessCustomer = JSON.parse(goCardlessCustomer);
      } catch (err) {
        console.error("Failed to parse goCardlessCustomer:", err.message);
      }
    }
    if (typeof goCardlessBankAccount === "string") {
      try {
        goCardlessBankAccount = JSON.parse(goCardlessBankAccount);
      } catch (err) {
        console.error("Failed to parse goCardlessBankAccount:", err.message);
      }
    }
    if (typeof goCardlessBillingRequest === "string") {
      try {
        goCardlessBillingRequest = JSON.parse(goCardlessBillingRequest);
      } catch (err) {
        console.error("Failed to parse goCardlessBillingRequest:", err.message);
      }
    }

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      studentId: payment.studentId,
      paymentType: payment.paymentType,
      // amount: payment.amount,
      paymentStatus: payment.paymentStatus,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      gatewayResponse, // parsed object
      transactionMeta, // parsed object
      goCardlessCustomer,
      goCardlessBankAccount,
    };
  });

  return parsedPayments;
};

exports.updateBookingWithStudents = async (
  bookingId,
  studentsPayload,
  transaction,
) => {
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
      transaction,
    });

    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 🔹 Update or create students, parents, emergency contacts
    let adminSynced = false; // 🔐 ensure admin updates once

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

        await studentRecord.save({ transaction });
      } else {
        studentRecord = await BookingStudentMeta.create(
          { bookingId, ...student },
          { transaction },
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
              transaction,
              paranoid: false,
            });

            if (admin && parent.parentEmail !== admin.email) {
              const emailExists = await Admin.findOne({
                where: {
                  email: parent.parentEmail,
                  id: { [Op.ne]: admin.id },
                },
                transaction,
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
              (p) => p.id === parent.id,
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

              await parentRecord.save({ transaction });
            }
          } else {
            parentRecord = await BookingParentMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...parent },
              { transaction },
            );
          }

          // 🔹 Sync FIRST parent → Admin (once)
          if (isFirstParent) {
            const admin = await Admin.findByPk(booking.parentAdminId, {
              transaction,
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

              await admin.save({ transaction });
              adminSynced = true;
            }
          }
        }
      }

      // 🔹 Emergency contacts
      if (Array.isArray(student.emergencyContacts)) {
        for (const emergency of student.emergencyContacts) {
          if (emergency.id) {
            const emergencyRecord = studentRecord.emergencyContacts?.find(
              (e) => e.id === emergency.id,
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

              await emergencyRecord.save({ transaction });
            }
          } else {
            await BookingEmergencyMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...emergency },
              { transaction },
            );
          }
        }
      }
    }

    // 🔹 Prepare structured response like getBookingsById
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
          })) || [],
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
          })) || [],
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
    console.error("❌ Service updateBookingWithStudents Error:", error.message);
    return { status: false, message: error.message };
  }
};
