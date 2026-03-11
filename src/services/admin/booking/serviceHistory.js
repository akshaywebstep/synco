const {
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  Venue,
  Admin,
  BookingPayment,
  TermGroup,
  PaymentGroup,
  PaymentPlan,
  PaymentGroupHasPlan,
  Term,
  OneToOneBooking,
  OneToOneStudent,
  OneToOneParent,
  OneToOneEmergency,
  OneToOnePayment,
  oneToOneLeads,
  BirthdayPartyBooking,
  BirthdayPartyStudent,
  BirthdayPartyParent,
  BirthdayPartyEmergency,
  BirthdayPartyPayment,
  BirthdayPartyLead,
  HolidayBooking,
  HolidayBookingStudentMeta,
  HolidayBookingParentMeta,
  HolidayBookingEmergencyMeta,
  HolidayBookingPayment,
  HolidayPaymentPlan,
  HolidayVenue,
  HolidayClassSchedule,
  HolidayCamp,
  HolidayCampDates,
  Discount,
  StarterPack,
  AppConfig,
} = require("../../../models");
const chargeStarterPack = require("../../../utils/payment/pay360/starterPackCharge");

const { sequelize } = require("../../../models");
const { Op } = require("sequelize");
const axios = require("axios");
const bcrypt = require("bcrypt");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const gbpToPence = (amount) => Math.round(Number(amount) * 100);
const DEBUG = process.env.DEBUG === "true";
const {
  createSchedule,
  getSchedules,
  createAccessPaySuiteCustomer,
  createContract,
  createOneOffPayment,
  createCustomerPayment,
  createContractPayment,
} = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const {
  createCustomer,
  createBankAccount,
  removeCustomer,
} = require("../../../utils/payment/pay360/customer");
function getNextBillingCycleDate() {
  const today = new Date();
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return next.toISOString().split("T")[0];
}
const {
  createBillingRequest,
  createPayment,
  createMandate,
  createSubscription,
  createOneOffPaymentGc,
  createOneOffPaymentGcViaApi,
} = require("../../../utils/payment/pay360/payment");
const stripePromise = require("../../../utils/payment/pay360/stripe");

const normalize = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

const uniqueBySignature = (items, signatureFn) => {
  const map = new Map();

  items.forEach(item => {
    const signature = signatureFn(item);
    if (signature) {
      map.set(signature, item);
    }
  });

  return Array.from(map.values());
};
function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    return str; // fallback: return original string if invalid JSON
  }
}

const REFERRAL_BASE_URL = "https://sharelink.com/get";
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

function countRemainingSessionsFromTerms(startDate, terms) {
  const start = new Date(startDate);
  let totalSessions = 0;

  const safeTerms = terms || [];
  safeTerms.forEach((term) => {
    if (term.totalSessions) {
      totalSessions += term.totalSessions;
    } else if (term.sessionsMap) {
      let sessions = term.sessionsMap;

      // If it's a string (JSON from DB), parse it
      if (typeof sessions === "string") {
        try {
          sessions = JSON.parse(sessions);
        } catch (err) {
          console.error("Failed to parse term.sessionsMap:", sessions);
          sessions = [];
        }
      }

      // Ensure it's an array before filtering
      if (Array.isArray(sessions)) {
        totalSessions += sessions.filter(
          (s) => new Date(s.sessionDate) >= start
        ).length;
      } else {
        console.warn("term.sessionsMap is not an array:", sessions);
      }
    }
  });

  return totalSessions;
}
async function calculateProRata({ paymentPlan, terms, startDate }) {
  if (!paymentPlan || !terms) return 0;

  const pricePerLesson = Number(paymentPlan.priceLesson || 0);
  if (!pricePerLesson) return 0;

  // Count remaining sessions across terms
  const sessions = countRemainingSessionsFromTerms(startDate, terms);

  // ✅ Multiply pricePerLesson * remaining sessions ONLY (no students here)
  return Number((pricePerLesson * sessions).toFixed(2));
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

function applyTimeBasedDiscount(price, bookingCreatedAt) {
  if (!bookingCreatedAt || !price) return price;

  const now = new Date();
  const createdAt = new Date(bookingCreatedAt);

  const hoursDiff =
    (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

  // First 24 hours → 50% discount
  if (hoursDiff <= 24) {
    return price * 0.5;
  }

  // Next 7 days → 25% discount
  if (hoursDiff <= 24 * 7) {
    return price * 0.75;
  }

  // After that → no discount
  return price;
}

exports.updateBooking = async (payload, adminId, id) => {
  const t = await sequelize.transaction();
  try {
    if (!id) throw new Error("Booking ID is required.");

    // 🔹 Step 1: Fetch existing booking
    const booking = await Booking.findOne({
      where: { id },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              include: [{ model: Venue, as: "venue" }],
            },
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
      ],

      transaction: t,
    });

    if (!booking) throw new Error("Booking not found.");

    // 🔹 Step 2: Update main booking fields
    const updateFields = [
      "totalStudents",
      "startDate",
      "paymentPlanId",
      "keyInformation",
      "venueId",
      "status",
      "serviceType",
    ];

    for (const field of updateFields) {
      if (payload[field] !== undefined) booking[field] = payload[field];
    }

    // Recompute after updates
    const wasTrial = booking.bookingType === "free";
    // 🔹 Auto set conversion metadata
    if (
      wasTrial &&
      (booking.paymentPlanId ||
        booking.serviceType?.toLowerCase().includes("membership"))
    ) {
      booking.isConvertedToMembership = true;

      // ✅ NEW FIELDS SAVE
      booking.convertedByAgentId = adminId;
      booking.convertedAt = new Date();
    }

    booking.bookingType = booking.paymentPlanId ? "paid" : "free";
    // booking.status = payload.status || booking.status || "active";
    booking.status = "active";
    booking.trialDate = null;
    booking.bookedBy = adminId || booking.bookedBy;

    booking.attempt = (booking.attempt || 0) + 1;

    // 🔹 Ensure correct serviceType
    if (
      !booking.serviceType ||
      booking.serviceType.trim() === "weekly class trial"
    ) {
      booking.serviceType = "weekly class membership";
    }

    // 🔹 Set isConvertedToMembership automatically
    if (
      wasTrial &&
      (booking.paymentPlanId ||
        booking.serviceType?.toLowerCase().includes("membership"))
    ) {
      booking.isConvertedToMembership = true;
    }

    // 🔹 Convert "rebooked" to "active" for membership upgrades
    const isMembership =
      booking.paymentPlanId ||
      booking.serviceType?.toLowerCase().includes("membership");

    if (booking.status === "rebooked" && isMembership) {
      booking.status = "active";
    }

    // 🔹 Persist all changes in one transaction-safe call
    await booking.save({ transaction: t });

    // 🔹 Step 3: Update Students, Parents, and Emergency Contacts
    if (Array.isArray(payload.students)) {
      let currentCount = booking.students.length;

      for (const student of payload.students) {
        if (student.id) {
          const existing = booking.students.find((s) => s.id === student.id);
          if (!existing) continue;

          await existing.update(
            {
              classScheduleId: student.classScheduleId,
              studentFirstName: student.studentFirstName,
              studentLastName: student.studentLastName,
              dateOfBirth: student.dateOfBirth,
              age: student.age,
              gender: student.gender,
              medicalInformation: student.medicalInformation || null,
              attendance: "not attended",   // ✅ ADD THIS
            },
            { transaction: t }
          );
        } else {
          if (currentCount >= 3)
            throw new Error("You cannot add more than 3 students per booking.");

          const newStudent = await BookingStudentMeta.create(
            {
              bookingTrialId: booking.id,
              classScheduleId: student.classScheduleId, // ✅ REQUIRED
              studentFirstName: student.studentFirstName,
              studentLastName: student.studentLastName,
              dateOfBirth: student.dateOfBirth,
              age: student.age,
              gender: student.gender,
              medicalInformation: student.medicalInformation || null,
              attendance: "not attended",   // ✅ ADD THIS
            },
            { transaction: t }
          );

          booking.students.push(newStudent);
          currentCount++;
        }
      }

      // Get first student (for linking parents/emergency)
      const firstStudent = booking.students[0];

      // 🔹 Parents
      if (Array.isArray(payload.parents) && firstStudent) {
        for (const parent of payload.parents) {
          if (parent.id) {
            const existingParent = await BookingParentMeta.findByPk(parent.id, {
              transaction: t,
            });
            if (existingParent) {
              await existingParent.update(
                {
                  parentFirstName: parent.parentFirstName,
                  parentLastName: parent.parentLastName,
                  parentEmail: parent.parentEmail,
                  parentPhoneNumber: parent.parentPhoneNumber,
                  relationToChild: parent.relationToChild,
                  howDidYouHear: parent.howDidYouHear,
                },
                { transaction: t }
              );
            } else {
              await BookingParentMeta.create(
                { ...parent, studentId: firstStudent.id },
                { transaction: t }
              );
            }
          } else {
            await BookingParentMeta.create(
              { ...parent, studentId: firstStudent.id },
              { transaction: t }
            );
          }
        }
      }

      // 🔹 Emergency Contact
      if (payload.emergency && firstStudent) {
        const emergency = payload.emergency;
        if (emergency.id) {
          const existingEmergency = await BookingEmergencyMeta.findByPk(
            emergency.id,
            { transaction: t }
          );
          if (existingEmergency) {
            await existingEmergency.update(
              {
                emergencyFirstName: emergency.emergencyFirstName,
                emergencyLastName: emergency.emergencyLastName,
                emergencyPhoneNumber: emergency.emergencyPhoneNumber,
                emergencyRelation: emergency.emergencyRelation,
              },
              { transaction: t }
            );
          }
        } else {
          await BookingEmergencyMeta.create(
            { ...emergency, studentId: firstStudent.id },
            { transaction: t }
          );
        }
      }
      // Commit if all good
      await t.commit();

      /* ================= STARTER PACK FIRST ================= */

      console.log("🔥 ===== STARTER PACK FLOW START =====");

      const venueForStarter = await Venue.findByPk(payload.venueId, {
        // transaction: t
      });

      console.log("🔥 booking venueId:", payload.venueId);
      console.log("🔥 venue found:", !!venueForStarter);
      console.log("🔥 starterPack flag:", venueForStarter?.starterPack);

      if (venueForStarter?.starterPack) {
        console.log("🔥 Starter pack enabled for venue");

        const parent = payload.parents?.[0];
        if (!parent) {
          console.log("❌ Parent missing");
          throw new Error("Parent required for starter pack");
        }

        // ✅ Use frontend price directly
        const starterPackAmount = Number(payload.starterPack || 0);

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
            studentId: firstStudent?.id,
            // ✅ ADD THESE
            firstName:
              payload.payment?.firstName || payload.parents?.[0]?.parentFirstName || "",
            lastName:
              payload.payment?.lastName || payload.parents?.[0]?.parentLastName || "",
            email: payload.payment?.email || payload.parents?.[0]?.parentEmail || "",
            parent,
            amount: starterPackAmount, // **dynamic from frontend**
            paymentType: "stripe",
            paymentCategory: "starter_pack",
            paymentStatus: "paid", // 🔥 ADD THIS
            gatewayResponse: stripeRes.raw,
            // transaction: t
          });

          console.log("🔥 Starter pack payment saved successfully");
        } else {
          console.log("⚠️ Starter pack amount invalid or 0");
        }
      }

      console.log("🔥 ===== STARTER PACK FLOW END =====");
    }
    // 🔹 Step 4: Payment processing
    // Payment processing (same as your logic but fixed typo and consistency)
    if (booking.paymentPlanId && payload.payment?.paymentType) {
      const venue = await Venue.findByPk(payload.venueId);
      const venueOwnerAdmin = await Admin.findByPk(venue.createdBy);
      const overrideToken = venueOwnerAdmin?.GC_FRANCHISE_TOKEN || null;
      // Always use GoCardless
      // No switching
      const paymentType = payload.payment?.paymentType || "bank";
      if (DEBUG) {
        console.log("Step 5: Start payment process, paymentType:", paymentType);
      }
      // const isHQVenue = !overrideToken;
      if (DEBUG)
        console.log("Step 5: Start payment process, paymentType:", paymentType);

      let paymentStatusFromGateway = "pending";
      const firstStudentId = booking.students?.[0]?.id || null;

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

        // Check if paylaod.students array exists and has at least 1 student
        if (Array.isArray(payload.students) && payload.students.length > 0) {
          effectiveScheduleId = payload.students[0].classScheduleId;
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

          totalPassedSessions += passedSessions.length;
          totalUpcomingSessions += upcomingSessions.length;

          console.log(`\n===== Term: ${term.termName} =====`);
          console.log("✅ Passed Sessions:", passedSessions);
          console.log("🕒 Upcoming Sessions:", upcomingSessions);
        });

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

        const startDate = new Date(payload.startDate);
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


        const proRataTotal = Number(payload?.payment?.proRataAmount ?? 0);

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
              email: payload.payment.email || payload.parents?.[0]?.parentEmail || "",
              given_name:
                payload.payment.firstName || payload.parents?.[0]?.parentFirstName,
              family_name:
                payload.payment.lastName || payload.parents?.[0]?.parentLastName,
              address_line1: payload.payment.addressLine1 || "",
              city: payload.payment.city || "",
              postal_code: payload.payment.postalCode || "",
              country_code: payload.payment.countryCode || "GB",
              account_holder_name: payload.payment.account_holder_name || "",
              account_number: payload.payment.account_number || "",
              branch_code: payload.payment.branch_code || "",
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
                // contract: { bookingId: booking.bookingId }, // number or string works now
                contract: { bookingId: booking.id }, // ✅ MUST HAVE booking.id for metadata
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
                parent: payload.parents?.[0],
                firstName:
                  payload.payment?.firstName || payload.parents?.[0]?.parentFirstName,
                lastName:
                  payload.payment?.lastName || payload.parents?.[0]?.parentLastName,
                email: payload.payment?.email || payload.parents?.[0]?.parentEmail,
                amount: firstMonthAmount,
                goCardlessMandateId: mandateId,
                goCardlessPaymentId: paymentRes.payment.id, // ✅ save payment id
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
            if (paymentPlan.duration === 1 && (!payload.payment?.proRataAmount || payload.payment.proRataAmount === 0)) {


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
                  payload.payment?.firstName || payload.parents?.[0]?.parentFirstName,
                lastName:
                  payload.payment?.lastName || payload.parents?.[0]?.parentLastName,
                email:
                  payload.payment?.email || payload.parents?.[0]?.parentEmail,
                amount: recurringAmount,
                paymentType: "bank",
                paymentCategory: "full_payment",
                paymentStatus: paymentRes.payment.status,
                goCardlessMandateId: mandateId,
                goCardlessPaymentId: paymentRes.payment.id,
                gatewayResponse: paymentRes,
                transaction: t
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
                // startDate: payload.startDate, // 👈 ye hona chahiye
                start_date: startDate,
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
                parent: payload.parents?.[0],
                // ✅ ADD THESE
                firstName:
                  payload.payment?.firstName ||
                  payload.parents?.[0]?.parentFirstName ||
                  "",
                lastName:
                  payload.payment?.lastName ||
                  payload.parents?.[0]?.parentLastName ||
                  "",
                email:
                  payload.payment?.email || payload.parents?.[0]?.parentEmail || "",
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
                // transaction: t
              });

              console.log("✅ Subscription created for remaining months");
            } else {
              console.log("🔥 Duration = 1 → No subscription created");
            }
          } catch (err) {
            // if (gcCustomer?.id)
            // await removeCustomer(gcCustomer.id, overrideToken);
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
            email: payload.payment?.email || payload.parents?.[0]?.parentEmail,
            title: "Mr",
            customerRef: `CUS-${booking.id}-${Date.now()}`,
            firstName:
              payload.payment?.firstName || payload.parents?.[0]?.parentFirstName,
            surname:
              payload.payment?.lastName || payload.parents?.[0]?.parentLastName,
            accountNumber: payload.payment?.account_number,
            bankSortCode: payload.payment?.branch_code,
            accountHolderName:
              payload.payment?.account_holder_name ||
              `${payload.parents?.[0]?.parentFirstName} ${payload.parents?.[0]?.parentLastName}`,
            line1: payload.payment?.address_line1 || "Test Address",
            town: payload.payment?.city || "London",
            postcode: payload.payment?.postcode || "SW1A1AA",
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

          // const startDate = calculateContractStartDate(18);
          const apsStartDate = getAPSNextPaymentDateFixed(0);
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
              firstName: payload.payment?.firstName || payload.parents?.[0]?.parentFirstName,
              lastName: payload.payment?.lastName || payload.parents?.[0]?.parentLastName,
              email: payload.payment?.email || payload.parents?.[0]?.parentEmail,
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
              firstName: payload.payment?.firstName || payload.parents?.[0]?.parentFirstName,
              lastName: payload.payment?.lastName || payload.parents?.[0]?.parentLastName,
              email: payload.payment?.email || payload.parents?.[0]?.parentEmail,

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
                firstName: payload.payment?.firstName || payload.parents?.[0]?.parentFirstName,
                lastName: payload.payment?.lastName || payload.parents?.[0]?.parentLastName,
                email: payload.payment?.email || payload.parents?.[0]?.parentEmail,

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


    // 🔹 Step 5: Return updated booking
    return await Booking.findOne({
      where: { id },
      include: [
        {
          model: ClassSchedule,
          as: "classSchedule",
          include: [{ model: Venue, as: "venue" }],
        },
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
  } catch (error) {
    await t.rollback();

    if (error.name === "SequelizeValidationError") {
      console.error("❌ Sequelize validation details:");
      error.errors.forEach((err) => {
        console.error(
          `- Field: ${err.path}, Message: ${err.message}, Value: ${err.value}`
        );
      });
    } else {
      console.error("❌ updateBooking Error:", error);
    }

    return { status: false, message: error.message };
  }
};

exports.updateBookingStudents = async (bookingId, studentsPayload, adminId) => {
  if (!adminId) throw new Error("Unauthorized");

  const t = await sequelize.transaction();

  try {
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

    if (!booking) throw new Error("Booking not found");

    let adminSynced = false; // 🔐 ensure admin updates once per booking

    for (const student of studentsPayload) {
      let studentRecord;

      // 🔹 Student update / create
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
          if (
            student[field] !== undefined &&
            student[field] !== null &&
            !(typeof student[field] === "string" && student[field].trim() === "")
          ) {
            studentRecord[field] = student[field];
          }
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
          let parentRecord;

          const isFirstParent =
            index === 0 && booking.parentAdminId && !adminSynced;

          // 🔒 PRE-CHECK email conflict BEFORE any update
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

          // 🔹 Parent update / create (SAFE now)
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
                if (
                  parent[field] !== undefined &&
                  parent[field] !== null &&
                  !(typeof parent[field] === "string" && parent[field].trim() === "")
                ) {
                  parentRecord[field] = parent[field];
                }
              });

              await parentRecord.save({ transaction: t });
            }
          } else {
            parentRecord = await BookingParentMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...parent },
              { transaction: t }
            );
          }

          // 🔹 Sync FIRST parent → Admin (only once)
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

      // 🔹 Emergency contacts
      if (Array.isArray(student.emergencyContacts)) {
        for (const emergency of student.emergencyContacts) {
          if (emergency.id) {
            const emergencyRecord =
              studentRecord.emergencyContacts?.find(
                (e) => e.id === emergency.id
              );

            if (emergencyRecord) {
              [
                "emergencyFirstName",
                "emergencyLastName",
                "emergencyPhoneNumber",
                "emergencyRelation",
              ].forEach((field) => {
                if (
                  emergency[field] !== undefined &&
                  emergency[field] !== null &&
                  !(typeof emergency[field] === "string" && emergency[field].trim() === "")
                ) {
                  emergencyRecord[field] = emergency[field];
                }

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

    await t.commit();

    return {
      status: true,
      message: "Booking students updated successfully",
      data: {
        bookingId: booking.id,
        status: booking.status,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ Service updateBookingStudents Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getBookingById = async (
  id,
  { role, adminId, superAdminId, childAdminIds }
) => {
  console.log("🔍 getBookingById params:", {
    id,
    role,
    adminId,
    superAdminId,
    childAdminIds,
  });

  const whereClause = { id };

  // ---------------- SUPER ADMIN ----------------
  if (role === "super admin") {
    whereClause[Op.or] = [
      {
        bookedBy: { [Op.in]: [adminId, ...childAdminIds] },
      },
      {
        bookedBy: null,
        source: "website",
        "$students.classSchedule.venue.createdBy$": adminId,
      },
    ];
  }

  // ---------------- ADMIN ----------------
  else if (role === "admin") {
    whereClause[Op.or] = [
      {
        bookedBy: { [Op.in]: [adminId, superAdminId].filter(Boolean) },
      },
      {
        bookedBy: null,
        source: "website",
        "$students.classSchedule.venue.createdBy$": {
          [Op.in]: [adminId, superAdminId].filter(Boolean),
        },
      },
    ];
  }

  // ---------------- AGENT ----------------
  else {
    whereClause.bookedBy = adminId;
  }

  console.log("🚀 Final whereClause:", JSON.stringify(whereClause, null, 2));
  try {
    console.log("🚀 Fetching booking from DB with whereClause:", whereClause);

    // 1️⃣ Fetch booking with related data
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
              required: true,
              include: [
                {
                  model: Venue,
                  as: "venue",
                  required: true,
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
        },
      ],
    });

    if (!booking) {
      return { status: false, message: "Booking not found or not authorized." };
    }

    // const venue = booking.classSchedule?.venue;
    const venue =
      booking.students?.[0]?.classSchedule?.venue || null;

    // 2️⃣ Handle PaymentGroups
    let paymentGroups = [];
    if (venue?.paymentGroupId) {
      let paymentGroupIds = [];
      if (typeof venue.paymentGroupId === "string") {
        try {
          paymentGroupIds = JSON.parse(venue.paymentGroupId);
        } catch {
          paymentGroupIds = [];
        }
      } else if (Array.isArray(venue.paymentGroupId)) {
        paymentGroupIds = venue.paymentGroupId;
      } else {
        paymentGroupIds = [venue.paymentGroupId]; // single number
      }

      if (paymentGroupIds.length) {
        paymentGroups = await PaymentGroup.findAll({
          where: {
            id: { [Op.in]: paymentGroupIds },
            createdBy: { [Op.in]: adminId },
          },
          include: [
            {
              model: PaymentPlan,
              as: "paymentPlans",
              through: { model: PaymentGroupHasPlan },
            },
          ],
          order: [["createdAt", "DESC"]],
        });
      }
    }

    // 3️⃣ Handle TermGroups + Terms with safe JSON parsing
    let termGroupIds = [];

    // Parse termGroupId from string/array/number
    if (typeof venue?.termGroupId === "string") {
      try {
        termGroupIds = JSON.parse(venue.termGroupId);
      } catch {
        termGroupIds = [];
      }
    } else if (Array.isArray(venue?.termGroupId)) {
      termGroupIds = venue.termGroupId;
    } else if (typeof venue?.termGroupId === "number") {
      termGroupIds = [venue.termGroupId];
    }

    // Use the creator of the venue to fetch termGroups and terms
    const creatorId = venue?.createdBy ?? adminId;

    const termGroups = termGroupIds.length
      ? await TermGroup.findAll({
        where: { id: termGroupIds, createdBy: creatorId },
      })
      : [];

    const terms = termGroupIds.length
      ? await Term.findAll({
        where: {
          termGroupId: { [Op.in]: termGroupIds },
          createdBy: creatorId,
        },
        attributes: [
          "id",
          "termName",
          "day",
          "startDate",
          "endDate",
          "termGroupId",
          "exclusionDates",
          "totalSessions",
          "sessionsMap",
        ],
      })
      : [];

    // Parse the terms safely
    const parsedTerms = terms.map((t) => ({
      id: t.id,
      name: t.termName,
      day: t.day,
      startDate: t.startDate,
      endDate: t.endDate,
      termGroupId: t.termGroupId,
      exclusionDates:
        typeof t.exclusionDates === "string"
          ? JSON.parse(t.exclusionDates)
          : t.exclusionDates || [],
      totalSessions: t.totalSessions,
      sessionsMap:
        typeof t.sessionsMap === "string"
          ? JSON.parse(t.sessionsMap)
          : t.sessionsMap || [],
    }));

    // 4️⃣ Extract students, parents, emergency contacts
    const students =
      booking.students?.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,

        classSchedule: s.classSchedule
          ? {
            id: s.classSchedule.id,
            className: s.classSchedule.className,
            startTime: s.classSchedule.startTime,
            endTime: s.classSchedule.endTime,
            venue: s.classSchedule.venue || null,
          }
          : null,
      })) || [];

    const parents =
      booking.students
        ?.flatMap((s) => s.parents || [])
        .map((p) => ({
          id: p.id,
          parentId: p.parentId,
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
          emergencyId: e.emergencyId,
          emergencyFirstName: e.emergencyFirstName,
          emergencyLastName: e.emergencyLastName,
          emergencyPhoneNumber: e.emergencyPhoneNumber,
          emergencyRelation: e.emergencyRelation,
        })) || [];

    // 5️⃣ Build final response
    const response = {
      id: booking.id,
      bookingId: booking.bookingId,
      attempt: booking.attempt,
      serviceType: booking.serviceType,
      trialDate: booking.trialDate,
      bookedBy: booking.bookedByAdmin || null,
      status: booking.status,
      totalStudents: booking.totalStudents,
      createdAt: booking.createdAt,
      venue,
      students,
      parents,
      emergency,

      // paymentGroups,
      // termGroups: termGroups.map((tg) => ({ id: tg.id, name: tg.name })),
      // terms: parsedTerms,
    };

    return {
      status: true,
      message: "Fetched booking details successfully.",
      data: response,
    };
  } catch (error) {
    console.error("❌ getBookingById Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getAccountInformation = async (parentAdminId) => {
  console.log("PARENT ADMIN ID:", parentAdminId);
  try {
    // Run both queries in parallel
    const [bookings, oneToOneLead, birthdayPartyLead, holidayBookings] = await Promise.all([
      Booking.findAll({
        where: { parentAdminId },
        include: [
          {
            model: BookingStudentMeta,
            as: "students",
            required: false,
            include: [
              { model: BookingParentMeta, as: "parents", required: false },
              { model: BookingEmergencyMeta, as: "emergencyContacts", required: false },
              /* ⭐ ADD THIS */
              {
                model: ClassSchedule,
                as: "classSchedule",
                required: false,
              },
            ],
          },
          {
            model: ClassSchedule,
            as: "classSchedule",
            required: false,
          },
          {
            model: Venue,
            as: "venue",
            required: false,
          },
          { model: BookingPayment, as: "payments" },
          {
            model: Admin, // 👈 include bookedBy Admin
            as: "bookedByAdmin",
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
        order: [["createdAt", "DESC"]],
      }),

      OneToOneBooking.findAll({
        where: { parentAdminId },
        include: [
          {
            model: OneToOneStudent,
            as: "students",
            include: [
              { model: OneToOneParent, as: "parentDetails" },
              {
                model: OneToOneEmergency,
                as: "emergencyDetails",
                attributes: [
                  "id",
                  "studentId",
                  "emergencyFirstName",
                  "emergencyLastName",
                  "emergencyPhoneNumber",
                  "emergencyRelation",
                ],
              },
            ],
          },
          { model: OneToOnePayment, as: "payment" },
          { model: PaymentPlan, as: "paymentPlan" },
          { model: Admin, as: "coach" },
          // ✅ ADD THIS
          {
            model: oneToOneLeads,
            as: "lead",
            required: false,
            include: [
              {
                model: Admin,
                as: "createdByAdmin",
                attributes: ["id", "firstName", "lastName", "email", "roleId", "status"],
                required: false,
              },
            ],
          },

        ],
      }),

      // ✅ Birthday Party Lead
      BirthdayPartyBooking.findAll({
        where: { parentAdminId },
        include: [
          {
            model: BirthdayPartyStudent,
            as: "students",
            include: [
              { model: BirthdayPartyParent, as: "parentDetails" },
              {
                model: BirthdayPartyEmergency,
                as: "emergencyDetails",
                attributes: [
                  "id",
                  "studentId",
                  "emergencyFirstName",
                  "emergencyLastName",
                  "emergencyPhoneNumber",
                  "emergencyRelation",
                ],
              },
            ],
          },
          { model: BirthdayPartyPayment, as: "payment" },
          { model: PaymentPlan, as: "paymentPlan" },
          { model: Admin, as: "coach" },

          // ✅ ADD THIS
          {
            model: BirthdayPartyLead,
            as: "lead",
            required: false,
            include: [
              {
                model: Admin,
                as: "createdByAdmin",
                attributes: ["id", "firstName", "lastName", "email", "roleId", "status"],
                required: false,
              },
            ],
          },
        ],
      }),

      // Holiday Booking
      HolidayBooking.findAll({
        where: { parentAdminId },
        include: [
          {
            model: HolidayBookingStudentMeta,
            as: "students",
            include: [
              { model: HolidayBookingParentMeta, as: "parents" },
              { model: HolidayBookingEmergencyMeta, as: "emergencyContacts" },
              /* ⭐ ADD THIS */
              {
                model: HolidayClassSchedule,
                as: "holidayClassSchedules",
                include: [{ model: HolidayVenue, as: "venue" }],
              },
            ],

          },
          { model: HolidayBookingPayment, as: "payment" },
          { model: HolidayPaymentPlan, as: "holidayPaymentPlan" },
          { model: HolidayVenue, as: "holidayVenue" },
          { model: Discount, as: "discount" },
          {
            model: Admin,
            as: "bookedByAdmin",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: HolidayCamp,
            as: "holidayCamp",
            include: [{ model: HolidayCampDates, as: "holidayCampDates" }],
          },
        ],
      }),
    ]);

    // Process bookings payment plans
    const paymentPlanIds = bookings.map((b) => b.paymentPlanId).filter(Boolean);

    let paymentPlans = [];
    if (paymentPlanIds.length) {
      paymentPlans = await PaymentPlan.findAll({
        where: { id: { [Op.in]: paymentPlanIds } },
      });
    }
    const paymentPlanMap = {};
    paymentPlans.forEach((plan) => {
      paymentPlanMap[plan.id] = plan;
    });
    const normalizeParent = (p) => ({
      id: p.id,
      studentId: p.studentId,
      parentFirstName: p.parentFirstName,
      parentLastName: p.parentLastName,
      parentEmail: p.parentEmail,
      parentPhoneNumber: p.phoneNumber || p.parentPhoneNumber || null,
      relationChild: p.relationChild || p.relationToChild || null,
      howDidHear: p.howDidHear || p.howDidYouHear || null,
    });
    const normalizeHolidayParent = (p) => ({
      id: p.id,
      studentId: p.studentId,
      parentFirstName: p.parentFirstName,
      parentLastName: p.parentLastName,
      parentEmail: p.parentEmail,

      // ✅ EXACT requirement
      parentPhoneNumber: p.parentPhoneNumber || p.phoneNumber || null,

      relationChild: p.relationChild || p.relationToChild || null,
      howDidHear: p.howDidHear || p.howDidYouHear || null,
    });

    const normalizeBookingPaymentFlat = (p) => ({
      id: p.id ?? null,
      bookingId: p.bookingId ?? null,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      email: p.email ?? null,
      billingAddress: p.billingAddress ?? null,
      cardHolderName: p.cardHolderName ?? null,
      cv2: p.cv2 ?? null,
      expiryDate: p.expiryDate ?? null,
      price: p.price ?? null,
      account_holder_name: p.account_holder_name ?? null,
      paymentType: p.paymentType ?? null,
      account_number: p.account_number ?? null,
      branch_code: p.branch_code ?? null,
      paymentStatus: p.paymentStatus ?? null,
      currency: p.currency ?? null,
      merchantRef: p.merchantRef ?? null,
      description: p.description ?? null,
      commerceType: p.commerceType ?? null,
      // ✅ Parse JSON fields if they exist
      gatewayResponse: p.gatewayResponse ? safeParseJSON(p.gatewayResponse) : null,
      goCardlessMandateId: p.goCardlessMandateId ?? null,
      goCardlessPaymentId: p.goCardlessPaymentId ?? null,
      goCardlessSubscriptionId: p.goCardlessSubscriptionId ?? null,
      contractId: p.contractId ?? null,
      directDebitRef: p.directDebitRef ?? null,
      transactionMeta: p.transactionMeta ? safeParseJSON(p.transactionMeta) : null,
      goCardlessCustomer: p.goCardlessCustomer ? safeParseJSON(p.goCardlessCustomer) : null,
      goCardlessBankAccount: p.goCardlessBankAccount ? safeParseJSON(p.goCardlessBankAccount) : null,
      goCardlessBillingRequest: p.goCardlessBillingRequest ? safeParseJSON(p.goCardlessBillingRequest) : null,
      createdAt: p.createdAt ?? null,
      updatedAt: p.updatedAt ?? null,
    });

    // Format bookings with paymentPlan attached
    const formattedBookings = bookings.map((bookingInstance) => {
      const booking = bookingInstance.get({ plain: true });

      /* ✅ DEBUG START */
      console.log("====== WEEKLY BOOKING DEBUG ======");
      console.log("BOOKING ID:", booking.id);
      console.log("RAW PAYMENTS FROM INCLUDE:", booking.payments);
      console.log("==================================");
      /* ---------------- Students ---------------- */
      const students =
        booking.students?.map((s) => ({
          id: s.id,
          studentFirstName: s.studentFirstName,
          studentLastName: s.studentLastName,
          dateOfBirth: s.dateOfBirth,
          age: s.age,
          gender: s.gender,
          medicalInformation: s.medicalInfo || s.medicalInformation || null,
          attendance: s.attendance || s.attendance,
          /* ⭐ ADD THIS */
          classSchedule: s.classSchedule || null,
        })) || [];

      /* ---------------- Parents ---------------- */
      const parents =
        booking.students?.flatMap((s) =>
          (s.parents || []).map((p) =>
            normalizeParent({ ...p, studentId: s.id })
          )
        ) || [];

      /* ---------------- Emergency ---------------- */
      const emergency =
        booking.students
          ?.flatMap((s) =>
            (s.emergencyContacts || []).map((e) => ({
              id: e.id,
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
          )
          ?.shift() || null;
      /* ---------------- Payments (FIXED) ---------------- */
      const payments =
        (booking.payments || []).map(normalizeBookingPaymentFlat);

      return {
        id: booking.id,
        parentAdminId: booking.parentAdminId,
        serviceType: booking.serviceType,
        status: booking.status,
        createdAt: booking.createdAt,
        bookedByAdmin: booking.bookedByAdmin || null, // ✅ ADD THIS
        venueId: booking.venueId || null, // ✅ NOW WORKS
        attempt: booking.attempt || null,
        venue: booking.venue || null, // ✅ NOW WORKS
        source: booking.source || null,
        paymentPlan: booking.paymentPlanId
          ? paymentPlanMap[booking.paymentPlanId] || null
          : null,

        students,
        parents,
        emergency,
        payments,
      };
    });

    // Format one-to-one lead if exists (reuse your existing formatting logic)
    const formattedOneToOneLead =
      (oneToOneLead || []).map((leadInstance) => {
        const leadPlain = leadInstance.get({ plain: true });
        const booking = leadPlain;

        const students =
          booking.students?.map((s) => ({
            id: s.id,
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInfo || null,
          })) || [];

        const parents =
          booking.students?.flatMap((s) =>
            (Array.isArray(s.parentDetails)
              ? s.parentDetails
              : s.parentDetails ? [s.parentDetails] : []
            ).map((p) =>
              normalizeParent({ ...p, studentId: s.id })
            )
          ) || [];

        const emergency =
          booking.students
            ?.flatMap((s) =>
              (Array.isArray(s.emergencyDetails)
                ? s.emergencyDetails
                : s.emergencyDetails
                  ? [s.emergencyDetails]
                  : []
              ).map((e) => ({
                emergencyFirstName: e.emergencyFirstName,
                emergencyLastName: e.emergencyLastName,
                emergencyPhoneNumber: e.emergencyPhoneNumber,
                emergencyRelation: e.emergencyRelation,
              }))
            )
            ?.shift() || null;
        const normalizeOneToOnePayment = (p) => {
          if (!p) return null;

          return {
            id: p.id,
            oneToOneBookingId: p.oneToOneBookingId,
            stripeSessionId: p.stripeSessionId,
            stripePaymentIntentId: p.stripePaymentIntentId,
            baseAmount: p.baseAmount,
            discountAmount: p.discountAmount,
            amount: p.amount,
            currency: p.currency,
            paymentStatus: p.paymentStatus,
            paymentDate: p.paymentDate,
            failureReason: p.failureReason,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          };
        };

        // ✅ FIXED PAYMENT
        const payment = normalizeOneToOnePayment(booking.payment);
        return {
          id: leadPlain.id,
          parentName: leadPlain.parentName,
          childName: leadPlain.childName,
          packageInterest: leadPlain.packageInterest,
          age: leadPlain.age,
          source: leadPlain.source,
          status: leadPlain.status,
          createdAt: leadPlain.createdAt,

          lead: leadPlain.lead || null,   // ✅ ADD THIS

          booking: {
            id: booking.id,
            coach: booking.coach,
            date: booking.date,
            time: booking.time,
            address: booking.address,
            location: booking.location,
            createdAt: booking.createdAt,
            students,
            parents,
            emergency,
            paymentPlan: booking.paymentPlan || null,
            payment,
          },
        };
      });

    // Format Birthday party
    const formattedBirthdayPartyLead =
      (birthdayPartyLead || []).map((leadInstance) => {
        const leadPlain = leadInstance.get({ plain: true });
        const booking = leadPlain;

        const students =
          booking.students?.map((s) => ({
            id: s.id,
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            gender: s.gender,
            age: s.age,
            dateOfBirth: s.dateOfBirth,
            medicalInformation: s.medicalInfo || null,
          })) || [];

        const parents =
          booking.students?.flatMap((s) =>
            (s.parentDetails || []).map((p) =>
              normalizeParent({ ...p, studentId: s.id })
            )
          ) || [];

        const emergency =
          booking.students
            ?.flatMap((s) => (s.emergencyDetails ? [s.emergencyDetails] : []))
            ?.map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
            ?.shift() || null;
        const normalizeBirthdayPartyPayment = (p) => {
          if (!p) return null;

          return {
            id: p.id,
            birthdayPartyBookingId: p.birthdayPartyBookingId,
            stripeSessionId: p.stripeSessionId,
            stripePaymentIntentId: p.stripePaymentIntentId,
            baseAmount: p.baseAmount,
            discountAmount: p.discountAmount,
            amount: p.amount,
            currency: p.currency,
            paymentStatus: p.paymentStatus,
            paymentDate: p.paymentDate,
            failureReason: p.failureReason,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          };
        };

        // ✅ FIXED PAYMENT
        const payment = normalizeBirthdayPartyPayment(booking.payment);

        return {
          id: leadPlain.id,
          // ✅ FIXED
          lead: leadPlain.lead || null,
          parentName: leadPlain.parentName,
          partyDate: leadPlain.partyDate,
          packageInterest: leadPlain.packageInterest,
          status: leadPlain.status,
          booking: {
            id: booking.id,
            coach: booking.coach,
            location: booking.location,
            address: booking.address,
            createdAt: booking.createdAt,
            students,
            parents,
            emergency,
            paymentPlan: booking.paymentPlan || null,
            payment,
          },
        };
      });

    const normalizeHolidayCamp = (camp) => {
      if (!camp) return null;

      return {
        id: camp.id,
        name: camp.name,
        description: camp.description || null,
        holidayCampDates: (camp.holidayCampDates || []).map(d => ({
          id: d.id,
          startDate: d.startDate,
          endDate: d.endDate,
          totalDays: d.totalDays,
          sessionsMap:
            typeof d.sessionsMap === "string"
              ? safeParseJSON(d.sessionsMap)
              : d.sessionsMap || [],
        })),
      };
    };

    // Format holiday bookings (multiple)
    const formattedHolidayBooking = await Promise.all(
      (holidayBookings || []).map(async (bookingInstance) => {
        const booking = bookingInstance.get({ plain: true });

        // Parents map and remove from students
        const parentMap = {};
        booking.students?.forEach((st) => {
          (st.parents || []).forEach((p) => (parentMap[p.id] = p));
          delete st.parents;
        });

        // Emergency contacts map and remove from students
        const emergencyMap = {};
        booking.students?.forEach((st) => {
          (st.emergencyContacts || []).forEach((e) => (emergencyMap[e.id] = e));
          delete st.emergencyContacts;
        });

        // Payment and Stripe details
        let paymentObj = null;

        if (booking.payment) {
          const stripeChargeId = booking.payment.stripe_payment_intent_id;
          let stripeChargeDetails = null;

          if (stripeChargeId) {
            try {
              const stripe = await stripePromise;

              if (stripeChargeId.startsWith("pi_")) {
                const pi = await stripe.paymentIntents.retrieve(
                  stripeChargeId,
                  { expand: ["latest_charge", "latest_charge.balance_transaction"] }
                );
                stripeChargeDetails = pi.latest_charge || null;
              } else if (stripeChargeId.startsWith("ch_")) {
                stripeChargeDetails = await stripe.charges.retrieve(
                  stripeChargeId,
                  { expand: ["balance_transaction"] }
                );
              }
            } catch (err) {
              console.error("⚠️ Holiday Stripe error:", err.message);
            }
          }

          paymentObj = {
            base_amount: booking.payment.base_amount,
            discount_amount: booking.payment.discount_amount,
            amount: booking.payment.amount,
            currency: booking.payment.currency,
            payment_status: booking.payment.payment_status,
            payment_date: booking.payment.payment_date,
            failure_reason: booking.payment.failure_reason,
            email: booking.payment.email,
            billingAddress: booking.payment.billingAddress,
            gatewayResponse: stripeChargeDetails,
          };
        }

        return {
          ...booking,
          parents: Object.values(parentMap).map(p =>
            normalizeHolidayParent(p)
          ),
          emergencyContacts: Object.values(emergencyMap),
          payment: paymentObj,
        };
      })
    );
    const profile = await Admin.findOne({
      where: { id: parentAdminId },
      attributes: ['id', 'firstName', 'lastName', 'email', 'roleId', 'referralCode'],
    });
    const profileWithReferralLink = profile
      ? {
        ...profile.get({ plain: true }),
        referralLink: profile.referralCode
          ? `${REFERRAL_BASE_URL}/${profile.referralCode}`
          : null,
      }
      : null;
    /* ---------- STUDENT SIGNATURE ---------- */
    const studentSignature = (s) => [
      normalize(s.studentFirstName),
      normalize(s.studentLastName),
      normalize(s.dateOfBirth),
      normalize(s.gender),
    ].join("|");

    /* ---------- PARENT SIGNATURE ---------- */

    const parentSignature = (p) => [
      normalize(p.parentEmail),
      normalize(p.parentPhoneNumber),
      normalize(p.parentFirstName),
      normalize(p.parentLastName),
      normalize(p.relationChild),
      normalize(p.howDidHear),
    ].join("|");

    /* ---------- EMERGENCY SIGNATURE ---------- */
    const emergencySignature = (e) => [
      normalize(e.emergencyPhoneNumber),
      normalize(e.emergencyFirstName),
    ].join("|");



    let allStudents = [];
    let allParents = [];
    let allEmergency = [];
    /* ---------------- WEEKLY ---------------- */
    formattedBookings.forEach(b => {
      allStudents.push(...(b.students || []));
      allParents.push(...(b.parents || []));
      if (b.emergency) allEmergency.push(b.emergency);
    });

    /* ---------------- ONE TO ONE ---------------- */
    formattedOneToOneLead.forEach(l => {
      const b = l.booking || {};
      allStudents.push(...(b.students || []));
      allParents.push(...(b.parents || []));
      if (b.emergency) allEmergency.push(b.emergency);
    });

    /* ---------------- BIRTHDAY ---------------- */
    formattedBirthdayPartyLead.forEach(l => {
      const b = l.booking || {};
      allStudents.push(...(b.students || []));
      allParents.push(...(b.parents || []));
      if (b.emergency) allEmergency.push(b.emergency);
    });

    formattedHolidayBooking.forEach(b => {
      (b.students || []).forEach(student => {
        const classInfo = student.classSchedule || {};

        allStudents.push({
          ...student,
        });
      });

      allParents.push(...(b.parents || []));
      allEmergency.push(...(b.emergencyContacts || []));
    });

    const uniqueStudents = uniqueBySignature(allStudents, studentSignature);
    const uniqueParents = uniqueBySignature(allParents, parentSignature);
    const uniqueEmergencyContacts = uniqueBySignature(allEmergency, emergencySignature);
    const weeklyBookings = formattedBookings.map(b => ({ ...b }));
    const oneToOneBookings = formattedOneToOneLead.map(l => ({
      id: l.id,
      parentAdminId,
      serviceType: "one to one",
      bookedByAdmin: l.lead?.createdByAdmin || null,
      status: l.status,
      createdAt: l.createdAt,
      coach: l.booking?.coach || null,
      location: l.booking?.location || null,  // ✅ NOW WORKS
      address: l.booking?.address || null,    // ✅ NOW WORKS
      date: l.booking?.date || null,
      time: l.booking?.time || null,
      paymentPlan: l.booking?.paymentPlan || null, // ✅ FIX
      payment: l.booking?.payment || null,
      students: l.booking?.students || [],
      parents: l.booking?.parents || [],
      emergency: l.booking?.emergency || null,
      // ✅ ADD ONLY THIS
      leads: l.lead
        ? {
          id: l.lead.id,
          parentName: l.lead.parentName,
          childName: l.lead.childName,
          age: l.lead.age,
          postCode: l.lead.postCode,
          packageInterest: l.lead.packageInterest,
          availability: l.lead.availability,
          source: l.lead.source,
          email: l.lead.email,
          notes: l.lead.notes,
          status: l.lead.status,
          createdAt: l.lead.createdAt,
        }
        : null,

    }));
    const birthdayBookings = formattedBirthdayPartyLead.map(l => ({
      id: l.id,
      parentAdminId,
      serviceType: "birthday party",
      status: l.status,
      createdAt: l.booking?.createdAt || null,
      coach: l.booking?.coach || null,
      bookedByAdmin: l.lead?.createdByAdmin || null,
      partyDate: l.partyDate,
      paymentPlan: l.booking?.paymentPlan || null, // ✅ FIX
      payment: l.booking?.payment || null,
      students: l.booking?.students || [],
      parents: l.booking?.parents || [],
      emergency: l.booking?.emergency || null,
      leads: l.lead
        ? {
          id: l.lead.id,
          parentName: l.lead.parentName,
          childName: l.lead.childName,
          age: l.lead.age,
          email: l.lead.email,
          phone: l.lead.phone,
          partyDate: l.lead.partyDate,
          packageInterest: l.lead.packageInterest,
          numberOfKids: l.lead.numberOfKids,
          source: l.lead.source,
          notes: l.lead.notes,
          status: l.lead.status,
          createdAt: l.lead.createdAt,
        }
        : null,

    }));
    const holidayBookingsNormalized = formattedHolidayBooking.map(b => {
      return {
        id: b.id,
        parentAdminId,
        serviceType: "holiday camp",
        bookedBy: b.bookedBy,
        marketingChannel: b.marketingChannel,
        status: b.status,
        createdAt: b.createdAt,

        holidayCamp: normalizeHolidayCamp(b.holidayCamp),
        venueId: b.venueId || null,
        venue: b.holidayVenue || null,

        paymentPlan: b.holidayPaymentPlan || null,

        students: (b.students || []).map(student => {
          const { holidayClassSchedules, ...studentData } = student;

          return {
            ...studentData,

            classSchedule: holidayClassSchedules
              ? {
                id: holidayClassSchedules.id,
                className: holidayClassSchedules.className,
                capacity: holidayClassSchedules.capacity,
                totalCapacity: holidayClassSchedules.totalCapacity,
                startTime: holidayClassSchedules.startTime,
                endTime: holidayClassSchedules.endTime
              }
              : null
          };
        }),

        parents: (b.parents || []).map(p => normalizeHolidayParent(p)),
        emergency: (b.emergencyContacts || [])[0] || null,
        payment: b.payment || null
      };
    });

    const combinedBookings = [
      ...weeklyBookings,
      ...birthdayBookings,
      ...oneToOneBookings,
      ...holidayBookingsNormalized,
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return {
      status: true,
      message: "Fetched combined bookings successfully.",
      data: {
        combinedBookings,
        // ✅ Separate parent data
        parents: uniqueParents,

        // ✅ Single emergency object
        emergency: uniqueEmergencyContacts.length
          ? uniqueEmergencyContacts[0]
          : null,
        // profile,  // single admin object for the parentAdminId
        // profile: profileWithReferralLink,
        // uniqueProfiles: {
        //   students: uniqueStudents,
        //   parents: uniqueParents,
        //   emergencyContacts: uniqueEmergencyContacts,
        // },
      },
    };
  } catch (error) {
    console.error("❌ getCombinedBookingsByParentAdminId Error:", error);
    return {
      status: false,
      message: error.message,
    };
  }
};


