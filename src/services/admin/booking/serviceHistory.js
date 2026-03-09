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
    (s) => s.Name && s.Name.trim().toLowerCase() === "default schedule",
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

          const startDate = calculateContractStartDate(18);

          const contractPayload = {
            ScheduleId: matchedSchedule.ScheduleId,
            Start: startDate,
            TerminationType: paymentPlan.duration ? "Fixed term" : "Until further notice",
          };

          if (paymentPlan.duration) {
            const start = new Date(startDate);
            const end = new Date(start);

            end.setMonth(end.getMonth() + Number(paymentPlan.duration));

            contractPayload.TerminationDate = end.toISOString().split("T")[0];
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
              date: startDate,
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
              date: startDate,
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


