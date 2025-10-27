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
} = require("../../../models");
const { sequelize } = require("../../../models");
const { Op } = require("sequelize");
const axios = require("axios");
const bcrypt = require("bcrypt");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createCustomer,
  removeCustomer,
} = require("../../../utils/payment/pay360/customer");
const {
  createBillingRequest,
} = require("../../../utils/payment/pay360/payment");
const DEBUG = process.env.DEBUG === "true";

exports.updateBookingStudents = async (bookingId, studentsPayload, adminId) => {
  if (!adminId) throw new Error("Unauthorized");

  const t = await sequelize.transaction();

  try {
    // 🔹 Fetch booking with related data
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

    // 🔹 Update students, parents, and emergency contacts
    for (const student of studentsPayload) {
      let studentRecord;

      if (student.id) {
        // Update existing student
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
        // Create new student
        studentRecord = await BookingStudentMeta.create(
          { bookingId, ...student },
          { transaction: t }
        );
      }

      // Parents
      if (Array.isArray(student.parents)) {
        for (const parent of student.parents) {
          if (parent.id) {
            const parentRecord = studentRecord.parents?.find(
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
            await BookingParentMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...parent },
              { transaction: t }
            );
          }
        }
      }

      // Emergency contacts
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

    await t.commit();

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
      message: "Booking students updated successfully",
      data: {
        bookingId: booking.id,
        status: booking.status,
        students,
        parents,
        emergencyContacts,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ Service updateBookingStudents Error:", error.message);
    return { status: false, message: error.message };
  }
};

// exports.getBookingById = async (id, adminId) => {
//   try {
//     const booking = await Booking.findOne({
//       where: { id },
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           required: false,
//           include: [
//             { model: BookingParentMeta, as: "parents", required: false },
//             {
//               model: BookingEmergencyMeta,
//               as: "emergencyContacts",
//               required: false,
//             },
//           ],
//         },
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           required: false,
//           include: [{ model: Venue, as: "venue", required: false }],
//         },
//         {
//           model: Admin, // ✅ Include bookedBy admin
//           as: "bookedByAdmin",
//           attributes: [
//             "id",
//             "firstName",
//             "lastName",
//             "email",
//             "roleId",
//             "status",
//             "profile",
//           ],
//           required: false,
//         },
//       ],
//     });

//     if (!booking) {
//       return { status: false, message: "Booking not found or not authorized." };
//     }

//     // Handle payment plans
//     let paymentPlans = [];
//     let paymentPlanIds = [];

//     const venue = booking.classSchedule?.venue;
//     if (venue?.paymentPlanId) {
//       if (typeof venue.paymentPlanId === "string") {
//         try {
//           paymentPlanIds = JSON.parse(venue.paymentPlanId);
//         } catch {
//           console.warn("⚠️ Failed to parse venue.paymentPlanId");
//         }
//       } else if (Array.isArray(venue.paymentPlanId)) {
//         paymentPlanIds = venue.paymentPlanId;
//       }

//       paymentPlanIds = paymentPlanIds
//         .map((id) => parseInt(id, 10))
//         .filter(Boolean);

//       if (paymentPlanIds.length) {
//         paymentPlans = await PaymentPlan.findAll({
//           where: { id: paymentPlanIds },
//         });
//       }
//     }

//     // Extract students
//     const students =
//       booking.students?.map((s) => ({
//         id: s.id, // <-- include DB id
//         studentId: s.studentId,
//         studentFirstName: s.studentFirstName,
//         studentLastName: s.studentLastName,
//         dateOfBirth: s.dateOfBirth,
//         age: s.age,
//         gender: s.gender,
//         medicalInformation: s.medicalInformation,
//       })) || [];

//     // Extract parents from first student
//     const parents =
//       booking.students?.[0]?.parents?.map((p) => ({
//         id: p.id, // <-- include DB id
//         parentId: p.parentId,
//         parentFirstName: p.parentFirstName,
//         parentLastName: p.parentLastName,
//         parentEmail: p.parentEmail,
//         parentPhoneNumber: p.parentPhoneNumber,
//         relationToChild: p.relationToChild,
//         howDidYouHear: p.howDidYouHear,
//       })) || [];

//     // Extract emergency contacts from first student
//     const emergency =
//       booking.students?.[0]?.emergencyContacts?.map((e) => ({
//         id: e.id, // <-- include DB id
//         emergencyId: e.emergencyId,
//         emergencyFirstName: e.emergencyFirstName,
//         emergencyLastName: e.emergencyLastName,
//         emergencyPhoneNumber: e.emergencyPhoneNumber,
//         emergencyRelation: e.emergencyRelation,
//       })) || [];

//     // Final response
//     const response = {
//       id: booking.id,
//       bookingId: booking.bookingId,
//       classScheduleId: booking.classScheduleId,
//       trialDate: booking.trialDate,
//       bookedBy: booking.bookedByAdmin || null, // ✅ full admin object
//       className: booking.className,
//       classTime: booking.classTime,
//       venueId: booking.venueId,
//       status: booking.status,
//       totalStudents: booking.totalStudents,
//       // source: booking.source,
//       createdAt: booking.createdAt,

//       students,
//       parents,
//       emergency,

//       classSchedule: booking.classSchedule || {},
//       paymentPlans,
//     };

//     return {
//       status: true,
//       message: "Fetched booking details successfully.",
//       data: response,
//     };
//   } catch (error) {
//     console.error("❌ getBookingById Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };

exports.getBookingById = async (id, adminId) => {
  console.log("🔍 Function getBookingById called with params:", { id, adminId });

  const whereClause = { id };
  console.log("🧩 Initial whereClause:", whereClause);

  // Only apply bookedBy filter if adminId is valid
  const adminIds = Array.isArray(adminId)
    ? adminId.filter(id => {
      const isValid = !isNaN(Number(id));
      console.log(`🧮 Checking adminId: ${id} → valid: ${isValid}`);
      return isValid;
    })
    : !isNaN(Number(adminId))
      ? [Number(adminId)]
      : [];

  console.log("📋 Valid adminIds array after filtering:", adminIds);

  if (adminIds.length) {
    whereClause.bookedBy = { [Op.in]: adminIds };
    console.log("✅ Added bookedBy filter to whereClause:", whereClause);
  } else {
    console.log("⚠️ No valid adminIds provided — bookedBy filter not applied");
  }

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
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          include: [{ model: Venue, as: "venue", required: false }],
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

    const venue = booking.classSchedule?.venue;

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
            createdBy: { [Op.in]: adminIds },
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
      classScheduleId: booking.classScheduleId,
      serviceType: booking.serviceType,
      trialDate: booking.trialDate,
      bookedBy: booking.bookedByAdmin || null,
      className: booking.className,
      classTime: booking.classTime,
      venueId: booking.venueId,
      status: booking.status,
      totalStudents: booking.totalStudents,
      createdAt: booking.createdAt,
      students,
      parents,
      emergency,
      classSchedule: booking.classSchedule || {},
      paymentGroups: paymentGroups.map((pg) => ({
        id: pg.id,
        name: pg.name,
        description: pg.description,
        createdBy: pg.createdBy,
        createdAt: pg.createdAt,
        updatedAt: pg.updatedAt,
        paymentPlans: (pg.paymentPlans || []).map((plan) => ({
          id: plan.id,
          title: plan.title,
          price: plan.price,
          priceLesson: plan.priceLesson,
          interval: plan.interval,
          duration: plan.duration,
          students: plan.students,
          joiningFee: plan.joiningFee,
          HolidayCampPackage: plan.HolidayCampPackage,
          termsAndCondition: plan.termsAndCondition,
          createdBy: plan.createdBy,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
          PaymentGroupHasPlan: plan.PaymentGroupHasPlan || null,
        })),
      })),
      termGroups: termGroups.map((tg) => ({ id: tg.id, name: tg.name })),
      terms: parsedTerms,
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

exports.updateBooking = async (payload, adminId, id) => {
  const t = await sequelize.transaction();
  try {
    if (!id) throw new Error("Booking ID is required.");

    // 🔹 Step 1: Fetch existing booking
    const booking = await Booking.findOne({
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
      transaction: t,
    });

    if (!booking) throw new Error("Booking not found.");

    // 🔹 Step 2: Update main booking fields
    const updateFields = [
      "totalStudents",
      "startDate",
      "paymentPlanId",
      "keyInformation",
      "classScheduleId",
      "venueId",
      "status",
      "serviceType",
    ];

    for (const field of updateFields) {
      if (payload[field] !== undefined) booking[field] = payload[field];
    }

    booking.bookingType = booking.paymentPlanId ? "paid" : "free";
    booking.status = payload.status || booking.status || "active";
    booking.trialDate = null;
    booking.bookedBy = adminId || booking.bookedBy;

    if (!booking.serviceType || booking.serviceType.trim() === "") {
      booking.serviceType = "weekly class membership";
    }

    await booking.save({ transaction: t });

    // 🔹 Step 3: Update Students, Parents, and Emergency Contacts
    if (Array.isArray(payload.students)) {
      let currentCount = booking.students.length;

      for (const student of payload.students) {
        if (student.id) {
          // Update existing student
          const existing = booking.students.find((s) => s.id === student.id);
          if (!existing) continue;
          await existing.update(student, { transaction: t });
        } else {
          // Create new student
          if (currentCount >= 3)
            throw new Error("You cannot add more than 3 students per booking.");

          const newStudent = await BookingStudentMeta.create(
            {
              bookingTrialId: booking.id,
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
            const existingParent = await BookingParentMeta.findByPk(parent.id, { transaction: t });
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
              await BookingParentMeta.create({ ...parent, studentId: firstStudent.id }, { transaction: t });
            }
          } else {
            await BookingParentMeta.create({ ...parent, studentId: firstStudent.id }, { transaction: t });
          }
        }
      }

      // 🔹 Emergency Contact
      if (payload.emergency && firstStudent) {
        const emergency = payload.emergency;
        if (emergency.id) {
          const existingEmergency = await BookingEmergencyMeta.findByPk(emergency.id, { transaction: t });
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
          await BookingEmergencyMeta.create({ ...emergency, studentId: firstStudent.id }, { transaction: t });
        }
      }
    }

    // 🔹 Step 4: Payment processing
    if (booking.paymentPlanId && payload.payment?.paymentType) {
      const paymentType = payload.payment.paymentType;
      let paymentStatusFromGateway = "pending";

      try {
        const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, { transaction: t });
        if (!paymentPlan) throw new Error("Invalid payment plan selected.");

        const price = paymentPlan.price || 0;
        const venue = await Venue.findByPk(payload.venueId, { transaction: t });
        const classSchedule = await ClassSchedule.findByPk(payload.classScheduleId, { transaction: t });
        const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
        const firstStudentId = booking.students?.[0]?.id;

        if (paymentType === "card") {
          if (
            !process.env.PAY360_INST_ID ||
            !process.env.PAY360_API_USERNAME ||
            !process.env.PAY360_API_PASSWORD
          ) {
            throw new Error("Pay360 credentials not configured.");
          }

          const paymentPayload = {
            transaction: {
              currency: "GBP",
              amount: price,
              merchantRef,
              description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"}`,
              commerceType: "ECOM",
            },
            paymentMethod: {
              card: {
                pan: payload.payment.pan,
                expiryDate: payload.payment.expiryDate,
                cardHolderName: payload.payment.cardHolderName,
                cv2: payload.payment.cv2,
              },
            },
          };

          const authHeader = Buffer.from(
            `${process.env.PAY360_API_USERNAME}:${process.env.PAY360_API_PASSWORD}`
          ).toString("base64");

          const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${process.env.PAY360_INST_ID}/payment`;
          const response = await axios.post(url, paymentPayload, {
            headers: { "Content-Type": "application/json", Authorization: `Basic ${authHeader}` },
          });

          const txnStatus = response.data?.transaction?.status?.toLowerCase();
          paymentStatusFromGateway =
            txnStatus === "success"
              ? "paid"
              : txnStatus === "pending"
                ? "pending"
                : txnStatus === "declined"
                  ? "failed"
                  : "unknown";
        } else if (paymentType === "bank") {
          // ⚠️ Fixed bug: replaced 'data' references with 'payload'
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

          const createCustomerRes = await createCustomer(customerPayload);
          if (!createCustomerRes.status)
            throw new Error(createCustomerRes.message || "Failed to create GoCardless customer.");

          const billingRequestPayload = {
            customerId: createCustomerRes.customer.id,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"}`,
            amount: price,
            scheme: "faster_payments",
            currency: "GBP",
            reference: `TRX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
            mandateReference: `MD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
            fallbackEnabled: true,
          };

          const createBillingRequestRes = await createBillingRequest(billingRequestPayload);
          if (!createBillingRequestRes.status) {
            await removeCustomer(createCustomerRes.customer.id);
            throw new Error(createBillingRequestRes.message || "Failed to create billing request.");
          }
        }

        // Save booking payment
        await BookingPayment.create(
          {
            bookingId: booking.id,
            paymentPlanId: booking.paymentPlanId,
            billingAddress: payload.payment.billingAddress || null,
            studentId: booking.students?.[0]?.id,
            paymentType,
            firstName: payload.payment.firstName || "",
            lastName: payload.payment.lastName || "",
            email: payload.payment.email || "",
            amount: paymentPlan.price,
            paymentStatus: paymentStatusFromGateway,
            merchantRef,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"}`,
          },
          { transaction: t }
        );

        if (paymentStatusFromGateway === "failed") {
          throw new Error("Payment failed. Booking not updated.");
        }
      } catch (err) {
        await t.rollback();
        const msg =
          err.response?.data?.reasonMessage ||
          err.response?.data?.error?.message ||
          err.message ||
          "Payment failed.";
        return { status: false, message: msg };
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
        console.error(`- Field: ${err.path}, Message: ${err.message}, Value: ${err.value}`);
      });
    } else {
      console.error("❌ updateBooking Error:", error);
    }

    return { status: false, message: error.message };
  }
};

// exports.updateBooking = async (payload, adminId, id) => {
//   const t = await sequelize.transaction();
//   try {
//     if (!id) throw new Error("Booking ID is required.");

//     // 🔹 Step 1: Fetch existing booking
//     const booking = await Booking.findOne({
//       where: { id },
//       include: [
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           include: [{ model: Venue, as: "venue" }],
//         },
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//       ],
//       transaction: t,
//     });

//     if (!booking) throw new Error("Booking not found.");

//     // 🔹 Step 2: Update main booking fields
//     const updateFields = [
//       "totalStudents",
//       "startDate",
//       "paymentPlanId",
//       "keyInformation",
//       "classScheduleId",
//       "venueId",
//     ];
//     updateFields.forEach((field) => {
//       if (payload[field] !== undefined) booking[field] = payload[field];
//     });

//     // ✅ Fix bookingType and status
//     booking.bookingType = "paid";
//     booking.status = "active";

//     // Remove trialDate if present
//     booking.trialDate = null;
//     booking.bookedBy = adminId || booking.bookedBy;

//     await booking.save({ transaction: t });

//     // 🔹 Step 3: Update existing students, parents, emergency contacts only
//     if (Array.isArray(payload.students)) {
//       for (const student of payload.students) {
//         if (!student.id) continue;
//         const studentRecord = booking.students.find((s) => s.id === student.id);
//         if (!studentRecord) continue;

//         Object.assign(studentRecord, student);
//         await studentRecord.save({ transaction: t });

//         // Update parents
//         if (Array.isArray(student.parents)) {
//           for (const parent of student.parents) {
//             if (!parent.id) continue;
//             const parentRecord = studentRecord.parents.find(
//               (p) => p.id === parent.id
//             );
//             if (parentRecord) {
//               Object.assign(parentRecord, parent);
//               await parentRecord.save({ transaction: t });
//             }
//           }
//         }

//         // Update emergency contacts
//         if (Array.isArray(student.emergencyContacts)) {
//           for (const emergency of student.emergencyContacts) {
//             if (!emergency.id) continue;
//             const emergencyRecord = studentRecord.emergencyContacts.find(
//               (e) => e.id === emergency.id
//             );
//             if (emergencyRecord) {
//               Object.assign(emergencyRecord, emergency);
//               await emergencyRecord.save({ transaction: t });
//             }
//           }
//         }
//       }
//     }

//     // 🔹 Step 4: Process Payment ONCE per booking
//     if (booking.paymentPlanId && payload.payment?.paymentType) {
//       const paymentType = payload.payment.paymentType; // "rrn" or "card"
//       console.log("Step 4: Start payment process, paymentType:", paymentType);

//       let paymentStatusFromGateway = "pending";
//       const firstStudentId = booking.students[0]?.id;

//       // Fetch payment plan & pricing
//       const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
//         transaction: t,
//       });
//       if (!paymentPlan) throw new Error("Invalid payment plan selected.");
//       const price = paymentPlan.price || 0;

//       // Fetch venue & classSchedule info
//       const venue = await Venue.findByPk(payload.venueId, { transaction: t });
//       const classSchedule = await ClassSchedule.findByPk(
//         payload.classScheduleId,
//         { transaction: t }
//       );

//       const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
//       let gatewayResponse = null;
//       const amountInPence = Math.round(price * 100);

//       try {
//         if (paymentType === "rrn") {
//           if (!payload.payment.referenceId)
//             throw new Error("Reference ID is required for RRN payments.");

//           const gcPayload = {
//             cardHolderName: null,
//             cv2: null,
//             expiryDate: null,
//             pan: null,
//             billing_requests: {
//               payment_request: {
//                 description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
//                   }`,
//                 amount: Math.round(price * 100),
//                 scheme: "faster_payments",
//                 currency: "GBP",
//                 metadata: { referenceId: payload.payment.referenceId },
//               },
//               mandate_request: {
//                 currency: "GBP",
//                 scheme: "bacs",
//                 verify: "recommended",
//                 metadata: { referenceId: payload.payment.referenceId },
//               },
//               links: {},
//               metadata: { test: `BR${Math.floor(Math.random() * 1000000)}` },
//             },
//           };

//           const response = await axios.post(
//             "https://api-sandbox.gocardless.com/billing_requests",
//             gcPayload,
//             {
//               headers: {
//                 Authorization: `Bearer ${process.env.GOCARDLESS_ACCESS_TOKEN}`,
//                 "Content-Type": "application/json",
//                 "GoCardless-Version": "2015-07-06",
//               },
//             }
//           );

//           gatewayResponse = response.data;
//           paymentStatus = "SUCCESS"; // Save as SUCCESS for RRN
//         } else if (paymentType === "card") {
//           if (
//             !process.env.PAY360_INST_ID ||
//             !process.env.PAY360_API_USERNAME ||
//             !process.env.PAY360_API_PASSWORD
//           )
//             throw new Error("Pay360 credentials not set.");

//           const paymentPayload = {
//             transaction: {
//               currency: "GBP",
//               amount: price,
//               merchantRef,
//               description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
//                 }`,
//               commerceType: "ECOM",
//             },
//             paymentMethod: {
//               card: {
//                 pan: payload.payment.pan,
//                 expiryDate: payload.payment.expiryDate,
//                 cardHolderName: payload.payment.cardHolderName,
//                 cv2: payload.payment.cv2,
//               },
//             },
//           };

//           const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${process.env.PAY360_INST_ID}/payment`;
//           const authHeader = Buffer.from(
//             `${process.env.PAY360_API_USERNAME}:${process.env.PAY360_API_PASSWORD}`
//           ).toString("base64");

//           const response = await axios.post(url, paymentPayload, {
//             headers: {
//               "Content-Type": "application/json",
//               Authorization: `Basic ${authHeader}`,
//             },
//           });

//           gatewayResponse = response.data;
//           const txnStatus = response.data?.transaction?.status?.toLowerCase();
//           if (["success", "paid"].includes(txnStatus))
//             paymentStatus = "SUCCESS";
//           else if (txnStatus === "pending") paymentStatus = "PENDING";
//           else if (txnStatus === "declined") paymentStatus = "FAILED";
//           else paymentStatus = txnStatus || "UNKNOWN";
//         }

//         // 🔹 Save payment
//         await BookingPayment.create(
//           {
//             bookingId: booking.id,
//             paymentPlanId: booking.paymentPlanId,
//             studentId: firstStudentId,
//             paymentType,
//             firstName: payload.payment.firstName || "",
//             lastName: payload.payment.lastName || "",
//             email: payload.payment.email || "",
//             billingAddress: payload.payment.billingAddress || "",
//             cardHolderName:
//               paymentType === "card" ? payload.payment.cardHolderName : null,
//             cv2: paymentType === "card" ? payload.payment.cv2 : null,
//             expiryDate:
//               paymentType === "card" ? payload.payment.expiryDate : null,
//             pan: paymentType === "card" ? payload.payment.pan : null,
//             referenceId: payload.payment.referenceId || "",
//             paymentStatus,
//             currency: "GBP",
//             merchantRef:
//               paymentType === "rrn" ? payload.payment.referenceId : merchantRef,
//             description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
//               }`,
//             commerceType: "ECOM",
//             gatewayResponse,
//             transactionMeta: { status: paymentStatus },
//             createdAt: new Date(),
//             updatedAt: new Date(),
//           },
//           { transaction: t }
//         );

//         console.log(
//           `${paymentType.toUpperCase()} payment saved with status:`,
//           paymentStatus
//         );
//         if (paymentStatus === "FAILED")
//           throw new Error("Payment failed. Booking not created.");
//       } catch (err) {
//         // 🔹 Detailed gateway error handling
//         await t.rollback();
//         let errorMessage = "Payment failed";
//         if (err.response?.data) {
//           if (typeof err.response.data === "string")
//             errorMessage = err.response.data;
//           else if (err.response.data.reasonMessage)
//             errorMessage = err.response.data.reasonMessage;
//           else if (err.response.data.error?.message)
//             errorMessage = err.response.data.error.message;
//           else errorMessage = JSON.stringify(err.response.data);
//         } else if (err.message) errorMessage = err.message;
//         return { status: false, message: errorMessage };
//       }
//     }

//     await t.commit();
//     // 🔹 Step 5: Return updated booking
//     return await Booking.findOne({
//       where: { id },
//       include: [
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           include: [{ model: Venue, as: "venue" }],
//         },
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
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ updateBooking Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };
