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
const {
  createSchedule,
  getSchedules,
  createAccessPaySuiteCustomer,
  createContract,
  createOneOffPayment
} = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const {
  createCustomer,
  removeCustomer,
} = require("../../../utils/payment/pay360/customer");
function getNextBillingCycleDate() {
  const today = new Date();
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return next.toISOString().split("T")[0];
}

const {
  createBillingRequest,
} = require("../../../utils/payment/pay360/payment");
const DEBUG = process.env.DEBUG === "true";

function generateBookingId(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
const gbpToPence = (amount) => Math.round(Number(amount) * 100);

function normalizeContractStartDate(requestedStartDate, matchedSchedule) {
  const requested = new Date(requestedStartDate);
  requested.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = requested.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 1) {
    throw new Error(
      `Start date must be at least 1 day after today (currently ${diffDays} day(s) from today)`
    );
  }

  if (matchedSchedule?.Start) {
    const scheduleStart = new Date(matchedSchedule.Start);
    scheduleStart.setHours(0, 0, 0, 0);

    if (requested < scheduleStart) {
      const diffScheduleDays = Math.ceil(
        (scheduleStart.getTime() - requested.getTime()) / (1000 * 60 * 60 * 24)
      );
      throw new Error(
        `Start date must be on or after ${matchedSchedule.Start.split("T")[0]
        } (${diffScheduleDays} day(s) later)`
      );
    }
  }

  return requested.toISOString().split("T")[0];
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
  amount,
  paymentType,
  description,
  paymentCategory = "recurring",
  gatewayResponse = null,
  currency = "GBP",
  merchantId = null,
  transaction,
}) {
  return await BookingPayment.create(
    {
      bookingId,
      studentId,
      firstName: parent?.firstName || "",
      lastName: parent?.lastName || "",
      email: parent?.email || "",
      amount,
      price: amount,
      paymentType,
      description,
      paymentCategory,
      paymentStatus: gatewayResponse ? "active" : "pending",
      currency,
      merchantRef:
        gatewayResponse?.transaction?.merchantRef || `TXN-${Date.now()}`,
      gatewayResponse,
      account_holder_name: parent.account_holder_name || null,
      account_number: parent.account_number || null,
      branch_code: parent.branch_code || null,
      goCardlessCustomer: gatewayResponse?.goCardlessCustomer || null,
      goCardlessBankAccount: gatewayResponse?.goCardlessBankAccount || null,
      goCardlessBillingRequest:
        gatewayResponse?.goCardlessBillingRequest || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { transaction },
  );
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
    booking.status = payload.status || booking.status || "active";
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

      const venue = await Venue.findByPk(booking.venueId, { transaction: t });
      if (venue?.starterPack) {
        const starterPack = await StarterPack.findOne({ where: { enabled: true } });
        if (starterPack && Number(starterPack.price) > 0) {
          const parent = payload.parents?.[0];
          if (!parent) throw new Error("Parent required for starter pack");

          // Apply discount based on booking creation time
          const discountedPrice = applyTimeBasedDiscount(
            Number(starterPack.price),
            booking.createdAt
          );

          const stripeRes = await chargeStarterPack({
            name: `${parent.parentFirstName} ${parent.parentLastName}`,
            email: parent.parentEmail,
            starterPack: { ...starterPack, price: discountedPrice }, // send discounted price
          });

          if (!stripeRes?.status) throw new Error("Starter pack payment failed");

          await createBookingPayment({
            bookingId: booking.id,
            studentId: firstStudent?.id,
            parent,
            amount: discountedPrice, // save discounted amount
            paymentType: "stripe",
            paymentCategory: "starter_pack",
            transactionMeta: {
              paymentIntentId: stripeRes.paymentIntentId,
              status: stripeRes.raw?.status,
            },
            gatewayResponse: stripeRes.raw,
            transaction: t
          });
        }
      }
    }
    // 🔹 Step 4: Payment processing
    // Payment processing (same as your logic but fixed typo and consistency)
    if (booking.paymentPlanId && payload.payment?.paymentType) {
      const venue = await Venue.findByPk(payload.venueId, { transaction: t });
      if (!venue) {
        throw new Error("Venue not found.");
      }

      const venueOwnerAdmin = await Admin.findByPk(venue.createdBy, { transaction: t });
      if (!venueOwnerAdmin) {
        throw new Error("Venue owner not found.");
      }
      const overrideToken = venueOwnerAdmin?.GC_FRANCHISE_TOKEN || null;
      const isHQVenue = !overrideToken;
      const paymentType = isHQVenue ? "accesspaysuite" : "bank";
      if (DEBUG)
        console.log("Step 5: Start payment process, paymentType:", paymentType);

      let paymentStatusFromGateway = "pending";
      const firstStudentId = booking.students?.[0]?.id;

      try {

        const paymentPlan = booking.paymentPlanId
          ? await PaymentPlan.findByPk(booking.paymentPlanId, { transaction: t })
          : null;

        if (!paymentPlan) {
          throw new Error("Payment plan not found.");
        }
        const primaryStudent = booking.students?.[0];
        const effectiveScheduleId = primaryStudent?.classScheduleId;

        if (!effectiveScheduleId) {
          throw new Error("Primary student classScheduleId missing");
        }

        const classSchedule = await ClassSchedule.findByPk(
          effectiveScheduleId,
          { transaction: t }
        );

        if (!classSchedule) {
          throw new Error("Class schedule not found.");
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


        const proRataAmount = await calculateProRata({
          paymentPlan,
          terms,
          startDate: payload.startDate,
        });

        const recurringAmount = Number(paymentPlan.price || 0);

        const proRataTotal = Number(
          (proRataAmount * (payload.totalStudents || 1)).toFixed(2)
        );



        // ✅ Step 2: frontend should send price only
        const frontendPrice = Number(payload.payment?.price);

        if (!frontendPrice || isNaN(frontendPrice)) {
          throw new Error("Invalid frontend price.");
        }

        if (Math.abs(frontendPrice - recurringAmount) > 0.01) {
          throw new Error(
            `Plan price mismatch. Frontend: ${frontendPrice}, Backend: ${recurringAmount}`
          );
        }

        console.log("✅ Price matches frontend and backend");

        const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;

        let gatewayResponse = null;
        let goCardlessCustomer = null;
        let goCardlessBankAccount = null;
        let goCardlessBillingRequest = null;
        // const paymentType = isHQVenue ? "accesspaysuite" : "bank";

        if (paymentType === "bank") {
          // ✅ Prepare GoCardless payload
          const customerPayload = {
            email: payload.payment.email || payload.parents?.[0]?.parentEmail || "",
            given_name: payload.payment.firstName || "",
            family_name: payload.payment.lastName || "",
            address_line1: payload.payment.addressLine1 || "",
            city: payload.payment.city || "",
            postal_code: payload.payment.postalCode || "",
            country_code: payload.payment.countryCode || "GB",
            currency: payload.payment.currency || "GBP",
            account_holder_name: payload.payment.account_holder_name || "",
            account_number: payload.payment.account_number || "",
            branch_code: payload.payment.branch_code || "",
          };

          const createCustomerRes = await createCustomer(customerPayload, overrideToken);
          if (!createCustomerRes.status || !createCustomerRes.customer?.id) {
            throw new Error(
              createCustomerRes.message || "Failed to create GoCardless customer."
            );
          }

          if (proRataTotal > 0) {
            if (!isHQVenue) {
              /* -------- Franchisee → GoCardless -------- */

              const gcRes = await createBillingRequest({
                customerId: createCustomerRes.customer.id,
                description: "Pro-rata lesson charge",
                amount: gbpToPence(proRataTotal),
              }, overrideToken);

              await createBookingPayment({
                bookingId: booking.id,
                studentId: firstStudentId,
                parent: payload.parents?.[0],
                amount: proRataTotal,
                paymentType: "bank",
                paymentCategory: "pro_rata",
                gatewayResponse: gcRes,
                transaction: t
              },
              );
            }
          }

          const billingRequestPayload = {
            customerId: createCustomerRes.customer.id,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            // amount: planPrice, // ✅ use plan price
            // amount: payloadPrice, // ✅ FROM PAYLOAD
            amount: gbpToPence(recurringAmount),
            scheme: "faster_payments",
            currency: "GBP",
            reference: `TRX-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000,
            )}`,
            mandateReference: `MD-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000,
            )}`,
            metadata: { crm_id: customerPayload.crm_id },
            fallbackEnabled: true,
          };

          const createBillingRequestRes = await createBillingRequest(
            billingRequestPayload,
            overrideToken
          );
          if (!createBillingRequestRes.status) {
            await removeCustomer(createCustomerRes.customer.id, overrideToken);
            throw new Error("GoCardless billing request failed.");
          }

          goCardlessCustomer = createCustomerRes.customer;
          goCardlessBankAccount = createCustomerRes.bankAccount;
          goCardlessBillingRequest = {
            ...createBillingRequestRes.billingRequest,
            // planPrice,
            price: recurringAmount,
          };

          gatewayResponse = {
            gateway: "gocardless",
            goCardlessCustomer,
            goCardlessBankAccount,
            goCardlessBillingRequest,
          };
        } else if (paymentType === "accesspaysuite") {
          if (DEBUG) console.log("🔁 Processing Access PaySuite recurring payment");

          const schedulesRes = await getSchedules();

          if (!schedulesRes?.status) {
            throw new Error("Access PaySuite: Failed to fetch schedules");
          }

          const services = schedulesRes.data?.Services || [];
          const schedules = services.flatMap(service => service.Schedules || []);

          let matchedSchedule = findMatchingSchedule(schedules, paymentPlan);

          if (!matchedSchedule) {
            throw new Error(
              `Access PaySuite: Schedule "Default Schedule" not found. Please create this schedule in APS dashboard before proceeding.`
            );
          }

          const scheduleId = matchedSchedule.ScheduleId;

          const customerPayload = {
            email: payload.payment?.email || payload.parents?.[0]?.parentEmail,
            title: "Mr",
            customerRef: `BOOK-${booking.id}-${Date.now()}`,
            firstName: payload.payment?.firstName || payload.parents?.[0]?.parentFirstName,
            surname: payload.payment?.lastName || payload.parents?.[0]?.parentLastName,
            line1: payload.payment?.addressLine1 || "10 Downing Street",
            postCode: payload.payment?.postalCode || "SW1A 2AA",
            accountNumber: payload.payment?.account_number,
            bankSortCode: payload.payment?.branch_code,
            accountHolderName:
              payload.payment?.account_holder_name ||
              `${payload.parents?.[0]?.parentFirstName} ${payload.parents?.[0]?.parentLastName}`,
          };

          const customerRes = await createAccessPaySuiteCustomer(customerPayload);
          if (!customerRes.status) {
            throw new Error(customerRes.message);   // ✅ gateway ka exact message
          }
          console.log("APS CREATE CUSTOMER RESPONSE:", customerRes);
          const customerId =
            customerRes.data?.CustomerId ||
            customerRes.data?.Id ||
            customerRes.data?.customerId ||
            customerRes.data?.id;

          if (!customerRes.data) {
            throw new Error("Access PaySuite: Invalid customer response.");
          }

          // ================= PRO-RATA CONTRACT =================
          if (proRataTotal > 0) {
            console.log("🔥 APS PRO RATA:", proRataTotal);

            const recurringContractStartDate = calculateContractStartDate(18);
            const proRataContractPayload = {
              scheduleName: matchedSchedule.Name,
              start: recurringContractStartDate,
              isGiftAid: false,
              terminationType: paymentPlan.duration ? "Fixed term" : "Until further notice",
              atTheEnd: "Switch to further notice",
              InitialAmount: proRataTotal,
            };
            if (paymentPlan.duration) {
              const start = new Date(recurringContractStartDate);
              const end = new Date(start);
              end.setMonth(end.getMonth() + Number(paymentPlan.duration));
              proRataContractPayload.TerminationDate = end.toISOString().split("T")[0];
            }

            const proRataContractRes = await createContract(customerId, proRataContractPayload);
            if (!proRataContractRes.status)
              throw new Error("Access PaySuite: Pro-rata contract creation failed");

            // Save PRO-RATA as separate BookingPayment row
            await BookingPayment.create({
              bookingId: booking.id,
              paymentPlanId: booking.paymentPlanId,
              studentId: firstStudentId,
              paymentType: "accesspaysuite",
              paymentCategory: "pro_rata",
              firstName: payload.payment?.firstName || payload.parents?.[0]?.parentFirstName || "",
              lastName: payload.payment?.lastName || payload.parents?.[0]?.parentLastName || "",
              email: payload.payment?.email || payload.parents?.[0]?.parentEmail || "",
              amount: proRataTotal,
              price: proRataTotal,
              billingAddress: payload.payment?.billingAddress || "",
              account_number: payload.payment?.account_number || "",
              branch_code: payload.payment?.branch_code || "",
              account_holder_name: payload.payment?.account_holder_name || "",
              paymentStatus: "active",
              currency: "GBP",
              merchantRef: `PR-${booking.id}-${Date.now()}`,
              description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"} (Pro-rata)`,
              commerceType: "ECOM",
              gatewayResponse: {
                gateway: "accesspaysuite",
                schedule: matchedSchedule,
                customer: customerRes.payload,
                contract: proRataContractRes.payload,
              },
              transactionMeta: { status: "active" },
              goCardlessCustomer: null,
              goCardlessBankAccount: null,
              goCardlessBillingRequest: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
              { transaction: t },
            );

            console.log("✅ APS pro-rata row saved same as recurring");
          }

          // ================= RECURRING CONTRACT =================
          const recurringContractStartDate = calculateContractStartDate(18);
          const recurringContractPayload = {
            scheduleName: matchedSchedule.Name,
            start: recurringContractStartDate,
            isGiftAid: false,
            terminationType: paymentPlan.duration ? "Fixed term" : "Until further notice",
            atTheEnd: "Switch to further notice",
          };
          if (paymentPlan.duration) {
            const start = new Date(recurringContractStartDate);
            const end = new Date(start);
            end.setMonth(end.getMonth() + Number(paymentPlan.duration));
            recurringContractPayload.TerminationDate = end.toISOString().split("T")[0];
          }

          console.log("APS Recurring Contract Payload:", recurringContractPayload);

          const recurringContractRes = await createContract(customerId, recurringContractPayload);
          if (!recurringContractRes.status)
            throw new Error("Access PaySuite: Recurring contract creation failed");
          gatewayResponse = {
            gateway: "accesspaysuite",
            schedule: matchedSchedule,
            customer: customerRes.payload,
            contract: recurringContractRes.payload,
          };

          paymentStatusFromGateway = "active";
        }

        // Save BookingPayment
        await BookingPayment.create({
          bookingId: booking.id,
          paymentPlanId: booking.paymentPlanId,
          studentId: firstStudentId,
          paymentType,
          paymentCategory: "recurring",
          firstName:
            payload.payment.firstName || payload.parents?.[0]?.parentFirstName || "",
          lastName:
            payload.payment.lastName || payload.parents?.[0]?.parentLastName || "",
          email: payload.payment.email || payload.parents?.[0]?.parentEmail || "",
          amount: recurringAmount, // plan + pro-rata
          price: recurringAmount, // plan + pro-rata
          billingAddress: payload.payment.billingAddress || "",
          account_number: payload.payment.account_number || "",
          branch_code: payload.payment.branch_code || "",
          account_holder_name: payload.payment.account_holder_name || "",
          paymentStatus: paymentStatusFromGateway,
          currency: gatewayResponse?.transaction?.currency || "GBP",
          merchantRef: gatewayResponse?.transaction?.merchantRef || merchantRef,
          description:
            gatewayResponse?.transaction?.description ||
            `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"}`,
          commerceType: "ECOM",
          gatewayResponse,
          transactionMeta: {
            status: gatewayResponse?.transaction?.status || "pending",
          },
          goCardlessCustomer: gatewayResponse?.goCardlessCustomer || null,
          goCardlessBankAccount: gatewayResponse?.goCardlessBankAccount || null,
          goCardlessBillingRequest:
            gatewayResponse?.goCardlessBillingRequest || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
          { transaction: t },
        );

        if (paymentStatusFromGateway === "failed")
          throw new Error("Payment failed. Booking not created.");

        if (DEBUG) {
          console.log(
            "🔍 [DEBUG] Payment processed with status:",
            paymentStatusFromGateway,
          );
        }
      } catch (error) {
        throw error;
      }
    }
    // Commit if all good
    await t.commit();

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


