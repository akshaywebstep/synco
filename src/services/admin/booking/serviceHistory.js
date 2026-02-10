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
  AppConfig,
} = require("../../../models");
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
} = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const {
  createCustomer,
  removeCustomer,
} = require("../../../utils/payment/pay360/customer");
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
    (s) => s.Name && s.Name.trim().toLowerCase() === "default schedule"
  );
}

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
          if (student[field] !== undefined) {
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
                if (parent[field] !== undefined) {
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
                if (emergency[field] !== undefined) {
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

    let paymentStatusFromGateway = null;
    let merchantRef = null;
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
    }

    // 🔹 Step 4: Payment processing
    if (booking.paymentPlanId && payload.payment?.paymentType) {
      const paymentType = payload.payment.paymentType;
      paymentStatusFromGateway = "pending";
      // use price from payload payment
      if (!payload.payment?.price || Number(payload.payment.price) <= 0) {
        throw new Error("Price must be provided in payload.payment.price and > 0");
      }
      // const payloadPrice = Number(payload.payment.price); // ✅ define once
      const originalPrice = Number(payload.payment.price);

      const discountedPrice = applyTimeBasedDiscount(
        originalPrice,
        booking.createdAt // ✅ free trial booking time
      );
      console.log("DISCOUNT CHECK", {
        originalPrice,
        discountedPrice,
        bookingCreatedAt: booking.createdAt,
      });

      const payloadPrice = Number(discountedPrice.toFixed(2));

      // ✅ ADD THESE (IMPORTANT)
      let customerId = null;
      let contractRes = null;
      let matchedSchedule = null;
      let customerRes = null; // ✅ ADD THIS

      try {
        const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
          transaction: t,
        });
        if (!paymentPlan) throw new Error("Invalid payment plan selected.");

        const primaryStudent = booking.students?.[0];
        if (!primaryStudent?.classScheduleId) {
          throw new Error("Primary student classScheduleId missing");
        }

        const classSchedule = await ClassSchedule.findByPk(
          primaryStudent.classScheduleId,
          { transaction: t }
        );

        const venue = await Venue.findByPk(payload.venueId, { transaction: t });

        // const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
        // const firstStudentId = booking.students?.[0]?.id;

        if (paymentType === "accesspaysuite") {
          if (DEBUG)
            console.log("🔁 Processing Access PaySuite recurring payment");

          const schedulesRes = await getSchedules();
          if (!schedulesRes.status) {
            throw new Error("Access PaySuite: Failed to fetch schedules");
          }

          const services = schedulesRes.data?.Services || [];
          const schedules = services.flatMap(
            (service) => service.Schedules || []
          );

          // let matchedSchedule = findMatchingSchedule(schedules, paymentPlan);
          matchedSchedule = findMatchingSchedule(schedules, paymentPlan);

          if (!matchedSchedule) {
            // DO NOT try to create the schedule
            throw new Error(
              `Access PaySuite: Schedule "Default Schedule" not found. Please create this schedule in APS dashboard before proceeding.`
            );
          }

          // Use matchedSchedule.id for contract creation
          // const scheduleId = matchedSchedule.ScheduleId;

          const customerPayload = {
            email: payload.payment?.email || payload.parents?.[0]?.parentEmail,
            title: "Mr",
            customerRef: `BOOK-${booking.id}-${Date.now()}`, // ✅ unique reference
            firstName:
              payload.payment?.firstName ||
              payload.parents?.[0]?.parentFirstName,
            surname:
              payload.payment?.lastName ??
              payload.parents?.[0]?.parentLastName ??
              "Unknown",
            line1: payload.payment?.addressLine1 || "N/A",
            postCode: payload.payment?.postalCode || "N/A",
            accountNumber: payload.payment?.account_number,
            bankSortCode: payload.payment?.branch_code,
            accountHolderName:
              payload.payment?.account_holder_name ||
              `${payload.parents?.[0]?.parentFirstName} ${payload.parents?.[0]?.parentLastName}`,
          };

          // const customerRes = await createAccessPaySuiteCustomer(
          //   customerPayload
          // );
          if (!payload.payment?.email?.includes("@")) {
            throw new Error("Invalid email address for Access PaySuite");
          }

          if (!payload.payment?.firstName) {
            throw new Error("First name is required for Access PaySuite");
          }

          if (
            !payload.parents?.[0]?.parentLastName &&
            !payload.payment?.lastName
          ) {
            throw new Error("Surname is required for Access PaySuite");
          }

          // const customerRes = await createAccessPaySuiteCustomer(customerPayload);
          customerRes = await createAccessPaySuiteCustomer(customerPayload);

          if (!customerRes.status) {
            console.error("APS CUSTOMER ERROR:", customerRes);
            throw new Error(
              customerRes.message ||
              customerRes.data?.Message ||
              "Access PaySuite: Customer creation failed"
            );
          }
          if (!customerRes.status)
            throw new Error("Access PaySuite: Customer creation failed");

          customerId =
            customerRes.data?.CustomerId ||
            customerRes.data?.Id ||
            customerRes.data?.customerId ||
            customerRes.data?.id;

          if (!customerId)
            throw new Error("Access PaySuite: Customer ID missing");

          const contractStartDate = calculateContractStartDate(18);

          const contractPayload = {
            scheduleName: matchedSchedule.Name,
            start: contractStartDate,
            isGiftAid: false,
            terminationType: paymentPlan.duration
              ? "Fixed term"
              : "Until further notice",
            atTheEnd: "Switch to further notice",
          };
          if (paymentPlan.duration) {
            const start = new Date(contractStartDate);
            const end = new Date(start);
            end.setMonth(end.getMonth() + Number(paymentPlan.duration));

            contractPayload.TerminationDate = end.toISOString().split("T")[0];
          }

          contractRes = await createContract(customerId, contractPayload);
          console.log("DEBUG contractRes:", contractRes);
          if (!contractRes.status)
            throw new Error("Access PaySuite: Contract creation failed");

          // ✅ Safe gatewayResponse save (FIXED)
          const contractId =
            contractRes?.data?.ContractId ||  // Preferred key
            contractRes?.ContractId ||        // Fallback
            contractRes?.data?.Id ||          // APS sometimes returns Id at top level
            contractRes?.Id ||                // Another fallback
            null;

          paymentStatusFromGateway = "active";
          merchantRef = `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        } else if (paymentType === "bank") {
          // ⚠️ Fixed bug: replaced 'data' references with 'payload'
          const customerPayload = {
            email:
              payload.payment.email || payload.parents?.[0]?.parentEmail || "",
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

          const createCustomerRes = await createCustomer(customerPayload);
          if (!createCustomerRes.status)
            throw new Error(
              createCustomerRes.message ||
              "Failed to create GoCardless customer."
            );

          const billingRequestPayload = {
            customerId: createCustomerRes.customer.id,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            // amount: price,
            // amount: payloadPrice, // ✅ use payloadPrice
            amount: gbpToPence(payloadPrice), // ✅ 147 pence
            scheme: "faster_payments",
            currency: "GBP",
            reference: `TRX-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000
            )}`,
            mandateReference: `MD-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000
            )}`,
            fallbackEnabled: true,
          };

          const createBillingRequestRes = await createBillingRequest(
            billingRequestPayload
          );
          if (!createBillingRequestRes.status) {
            await removeCustomer(createCustomerRes.customer.id);
            throw new Error(
              createBillingRequestRes.message ||
              "Failed to create billing request."
            );
          }
        }
        console.log("Contract Response:", contractRes);
        console.log("APS PAYMENT DATA", {
          customerId,
          contract: contractRes?.data,
          schedule: matchedSchedule,
        });
        const payerFirstName =
          payload.payment?.firstName ||
          payload.parents?.[0]?.parentFirstName ||
          "Unknown";

        const payerLastName =
          payload.payment?.lastName ||
          payload.parents?.[0]?.parentLastName ||
          "Unknown";

        const payerEmail =
          payload.payment?.email ||
          payload.parents?.[0]?.parentEmail ||
          "no-reply@example.com";

        let gatewayResponse = null;

        if (paymentType === "accesspaysuite") {
          gatewayResponse = {
            gateway: "accesspaysuite",
            schedule: matchedSchedule,
            customer: customerRes?.data || {},
            contract: contractRes?.data || {},
          };
        }

        const transactionMeta = {
          status: paymentStatusFromGateway,
        };
        merchantRef = `TRX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        // Save booking payment
        await BookingPayment.create(
          {
            bookingId: booking.id,
            paymentPlanId: booking.paymentPlanId,
            studentId: booking.students?.[0]?.id,

            firstName: payerFirstName,
            lastName: payerLastName,
            email: payerEmail,

            paymentType,
            price: payloadPrice, //payload price
            paymentStatus: paymentStatusFromGateway,
            merchantRef,
            description: `${venue?.name} - ${classSchedule?.className}`,
            currency: "GBP",
            // ✅ Minimal clean gateway response
            // ✅ EXACT MATCH
            gatewayResponse,
            transactionMeta,
          },
          { transaction: t }
        );

        if (paymentStatusFromGateway === "failed") {
          throw new Error("Payment failed. Booking not updated.");
        }
      } catch (err) {
        throw err; // let outer catch handle rollback
      }
    }
    if (paymentStatusFromGateway === "active") {
      booking.status = "active";
      await booking.save({ transaction: t });
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
