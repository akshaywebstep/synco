const {
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  Booking,
  ClassSchedule,
  Venue,
  BookingPayment,
  PaymentPlan,
  Admin,
  // Feedback,
} = require("../../../models");
const { Op } = require("sequelize");
const { sequelize } = require("../../../models");

exports.getAllStudentsListing = async (filters = {}) => {
  try {
    const { bookedBy, paymentPlanId, classScheduleId } = filters;

    // Base booking filters
    let studentsWhere = {
      bookingType: "paid",
    };

    // Apply filters if they exist
    if (bookedBy) {
      const bookedByArray = Array.isArray(bookedBy)
        ? bookedBy
        : [bookedBy];

      studentsWhere.bookedBy = { [Op.in]: bookedByArray };
    }

    if (paymentPlanId) {
      studentsWhere.paymentPlanId = paymentPlanId;
    }

    if (classScheduleId) {
      studentsWhere.classScheduleId = classScheduleId;
    }

    const students = await BookingStudentMeta.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          required: false,
          attributes: [
            "id",
            "bookingType",
            "bookingId",
            "leadId",
            "venueId",
            "classScheduleId",
            "paymentPlanId",
            "trialDate",
            "startDate",
            "status",
            "totalStudents",
            "interest",
            "bookedBy",
            "additionalNote",
            "reasonForNonAttendance",
            "serviceType",
            "createdAt",
            "updatedAt",
          ],
          where: studentsWhere,
          include: [
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
              model: ClassSchedule,
              as: "classSchedule",
              required: false,
              include: [
                {
                  model: Venue,
                  as: "venue",
                  required: false,
                },
              ],
            },
            {
              model: Venue,
              as: "venue",
              required: false,
            },
            {
              model: PaymentPlan,
              as: "paymentPlan",
              required: false,
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
    });

    // =========================
    // Grouping Logic
    // =========================
    const grouped = {};

    students.forEach((student) => {
      const booking = student.booking;
      if (!booking) return;

      const bookingId = booking.id;

      if (!grouped[bookingId]) {
        grouped[bookingId] = {
          id: booking.id,
          bookingType: booking.bookingType,
          bookingId: booking.bookingId,
          serviceType: booking.serviceType,
          leadId: booking.leadId,
          venueId: booking.venueId,
          venue: booking.venue || null,
          classScheduleId: booking.classScheduleId,
          classSchedule: booking.classSchedule || null,
          paymentPlanId: booking.paymentPlanId,
          paymentPlan: booking.paymentPlan || null,
          bookedBy: booking.bookedBy,
          bookedByAdmin: booking.bookedByAdmin || null,
          trialDate: booking.trialDate,
          startDate: booking.startDate,
          status: booking.status,
          totalStudents: booking.totalStudents,
          interest: booking.interest,
          additionalNote: booking.additionalNote,
          reasonForNonAttendance: booking.reasonForNonAttendance,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
          students: [],
          parents: [],
          emergency: [],
        };
      }

      // Add student
      grouped[bookingId].students.push({
        id: student.id,
        bookingTrialId: student.bookingTrialId,
        studentFirstName: student.studentFirstName,
        studentLastName: student.studentLastName,
        dateOfBirth: student.dateOfBirth,
        age: student.age,
        gender: student.gender,
        medicalInformation: student.medicalInformation,
      });

      // Add parents (avoid duplicates)
      (student.parents || []).forEach((p) => {
        if (!grouped[bookingId].parents.some((x) => x.id === p.id)) {
          grouped[bookingId].parents.push({
            id: p.id,
            studentId: p.studentId,
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          });
        }
      });

      // Add emergency contacts (avoid duplicates)
      (student.emergencyContacts || []).forEach((e) => {
        if (!grouped[bookingId].emergency.some((x) => x.id === e.id)) {
          grouped[bookingId].emergency.push({
            id: e.id,
            studentId: e.studentId,
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          });
        }
      });
    });

    // =========================
    // ✅ SORT NEWEST BOOKINGS ON TOP (FIX)
    // =========================
    const accountInformation = Object.values(grouped).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    return {
      status: true,
      message: "Bookings retrieved successfully",
      data: {
        accountInformation,
      },
    };
  } catch (error) {
    console.error("❌ getAllStudentsListing Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getStudentByBookingId = async (bookingId) => {
  try {
    if (!bookingId) {
      return { status: false, message: "Booking ID is required" };
    }

    // ✅ Get ALL students for this booking
    const students = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
      include: [
        {
          model: Booking,
          as: "booking",
          required: false,
          include: [
            { model: Admin, as: "bookedByAdmin", required: false },
            {
              model: ClassSchedule,
              as: "classSchedule",
              required: false,
              include: [{ model: Venue, as: "venue", required: false }],
            },
            { model: PaymentPlan, as: "paymentPlan", required: false },
            { model: BookingPayment, as: "payments", required: false },
          ],
        },
        { model: BookingParentMeta, as: "parents", required: false },
        {
          model: BookingEmergencyMeta,
          as: "emergencyContacts",
          required: false,
        },
      ],
    });

    if (!students || students.length === 0) {
      return { status: false, message: "No students found for this booking" };
    }

    // Extract booking once (same booking for all students)
    const booking = students[0].booking;
    const plan = booking?.paymentPlan || null;

    // Format payments
    const payments = booking?.payments || [];
    const safeParse = (field) => {
      try {
        return typeof field === "string" ? JSON.parse(field) : field;
      } catch {
        return field;
      }
    };

    const paymentData = payments.map((p) => {
      const data = p.toJSON();
      return {
        ...data,
        gatewayResponse: safeParse(data.gatewayResponse),
        transactionMeta: safeParse(data.transactionMeta),
        goCardlessCustomer: safeParse(data.goCardlessCustomer),
        goCardlessBankAccount: safeParse(data.goCardlessBankAccount),
        goCardlessBillingRequest: safeParse(data.goCardlessBillingRequest),
        totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
      };
    });

    // ✅ MAP ALL STUDENTS, NOT JUST ONE
    const formattedStudents = students.map((s) => ({
      id: s.id,
      bookingTrialId: s.bookingTrialId,
      studentFirstName: s.studentFirstName,
      studentLastName: s.studentLastName,
      dateOfBirth: s.dateOfBirth,
      age: s.age,
      gender: s.gender,
      medicalInformation: s.medicalInformation,
    }));

    const parents = students.flatMap((s) =>
      (s.parents || []).map((p) => ({
        id: p.id,
        studentId: p.studentId,
        parentFirstName: p.parentFirstName,
        parentLastName: p.parentLastName,
        parentEmail: p.parentEmail,
        parentPhoneNumber: p.parentPhoneNumber,
        relationToChild: p.relationToChild,
        howDidYouHear: p.howDidYouHear,
      }))
    );

    const emergency = students.flatMap((s) =>
      (s.emergencyContacts || []).map((e) => ({
        id: e.id,
        studentId: e.studentId,
        emergencyFirstName: e.emergencyFirstName,
        emergencyLastName: e.emergencyLastName,
        emergencyPhoneNumber: e.emergencyPhoneNumber,
        emergencyRelation: e.emergencyRelation,
      }))
    );

    return {
      status: true,
      message: "Students retrieved successfully",
      data: {
        accountInformation: {
          id: booking?.id || null,
          bookingType: booking?.bookingType,
          bookingId: booking?.bookingId,
          leadId: booking?.leadId,
          venueId: booking?.venueId,
          classScheduleId: booking?.classScheduleId,
          classSchedule: booking?.classSchedule || null,
          serviceType: booking?.serviceType,
          paymentPlanId: booking?.paymentPlanId,
          paymentPlan: booking?.paymentPlan || null,
          bookedBy: booking?.bookedBy,
          bookedByAdmin: booking?.bookedByAdmin || null,
          trialDate: booking?.trialDate,
          startDate: booking?.startDate,
          status: booking?.status,
          totalStudents: booking?.totalStudents,
          interest: booking?.interest,
          additionalNote: booking?.additionalNote,
          reasonForNonAttendance: booking?.reasonForNonAttendance,
          createdAt: booking?.createdAt,
          updatedAt: booking?.updatedAt,
          students: formattedStudents, // ✅ MULTIPLE STUDENTS HERE
          parents,
          emergency,
          paymentData,
        },
      },
    };
  } catch (error) {
    console.error("❌ getStudentByBookingId Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.updateBookingWithStudents = async (bookingId, payload, transaction) => {
  try {
    const { students = [], parents = [], emergencyContacts = [] } = payload;

    // Fetch booking and associations
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

    if (!booking) return { status: false, message: "Booking not found" };

    // const firstStudent = booking.students[0];

    // ======================
    // 🟢 Update / Add Students
    // ======================
    for (const student of students) {
      let studentRecord;

      if (student.id) {
        studentRecord = booking.students.find((s) => s.id === student.id);
        if (studentRecord) {
          const studentFields = [
            "studentFirstName",
            "studentLastName",
            "dateOfBirth",
            "age",
            "gender",
            "medicalInformation",
          ];
          for (const field of studentFields) {
            if (student[field] !== undefined)
              studentRecord[field] = student[field];
          }
          await studentRecord.save({ transaction });
        }
      } else {
        studentRecord = await BookingStudentMeta.create(
          { bookingId: booking.id, bookingTrialId: booking.id, ...student },
          { transaction }
        );
      }

      // ======================
      // 🟢 Nested parents (per student)
      // ======================
      if (Array.isArray(student.parents)) {
        const existingParents = await studentRecord.getParents({ transaction });

        for (const parent of student.parents) {
          if (parent.id) {
            const parentRecord = existingParents.find(
              (p) => p.id === parent.id
            );
            if (parentRecord) {
              const parentFields = [
                "parentFirstName",
                "parentLastName",
                "parentEmail",
                "parentPhoneNumber",
                "relationToChild",
                "howDidYouHear",
              ];
              for (const f of parentFields)
                if (parent[f] !== undefined) parentRecord[f] = parent[f];
              await parentRecord.save({ transaction });
            }
          } else {
            await BookingParentMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...parent },
              { transaction }
            );
          }
        }
      }
    }

    // ======================
    // 🟡 Top-level parents (linked to first student)
    // ======================

    let firstStudent = booking.students[0];

    if (!firstStudent && students.length > 0) {
      // If no students existed before, take the first from the payload and create it
      firstStudent = await BookingStudentMeta.create(
        { bookingId: booking.id, bookingTrialId: booking.id, ...students[0] },
        { transaction }
      );
      // Also push it to booking.students to maintain consistency
      booking.students.push(firstStudent);
    }

    if (Array.isArray(parents) && parents.length > 0) {
      for (const parent of parents) {
        if (parent.id) {
          const parentRecord = await BookingParentMeta.findByPk(parent.id, {
            transaction,
          });
          if (parentRecord) {
            const parentFields = [
              "parentFirstName",
              "parentLastName",
              "parentEmail",
              "parentPhoneNumber",
              "relationToChild",
              "howDidYouHear",
            ];
            for (const f of parentFields)
              if (parent[f] !== undefined) parentRecord[f] = parent[f];
            await parentRecord.save({ transaction });
          }
        } else {
          await BookingParentMeta.create(
            { studentId: firstStudent.id, ...parent }, // ✅ link to first student
            { transaction }
          );
        }
      }
    }

    // ======================
    // 🔴 Emergency Contacts
    // ======================
    for (const emergency of emergencyContacts) {
      if (emergency.id) {
        const emergencyRecord = await BookingEmergencyMeta.findByPk(
          emergency.id,
          { transaction }
        );
        if (emergencyRecord) {
          const fields = [
            "emergencyFirstName",
            "emergencyLastName",
            "emergencyPhoneNumber",
            "emergencyRelation",
          ];
          for (const f of fields)
            if (emergency[f] !== undefined) emergencyRecord[f] = emergency[f];
          await emergencyRecord.save({ transaction });
        }
      } else if (firstStudent) {
        // Optionally create new emergency contact
        await BookingEmergencyMeta.create(
          { bookingStudentMetaId: firstStudent.id, ...emergency },
          { transaction }
        );
      }
    }

    // ======================
    // ✅ Return updated booking
    // ======================
    const refreshedBooking = await Booking.findOne({
      where: { id: bookingId },
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
      transaction,
    });

    return {
      status: true,
      message: "Booking updated successfully",
      data: refreshedBooking,
    };
  } catch (error) {
    console.error("❌ Service updateBookingWithStudents Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getVenuesWithClassesFromBookings = async (bookingId) => {
  try {
    const booking = await Booking.findOne({
      where: { id: bookingId },
      include: [
        {
          model: ClassSchedule,
          as: "classSchedule",
          include: [
            {
              model: Venue,
              as: "venue",
            },
          ],
        },
      ],
    });

    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    const venue = booking.classSchedule?.venue;

    const response = {
      venueId: venue?.id || null,
      venueName: venue?.name || null,
      classes: [
        {
          classScheduleId: booking.classSchedule?.id,
          className: booking.classSchedule?.className || null,
          startTime: booking.classSchedule?.startTime || null,
          endTime: booking.classSchedule?.endTime || null,
          dayOfWeek: booking.classSchedule?.day || null,
        },
      ],
      booking: {
        bookedBy: booking.bookedBy || null, // include bookedBy from Booking
        bookingId: booking.id,
      },
    };

    return {
      status: true,
      message: "Venue with classes retrieved successfully",
      data: [response],
    };
  } catch (error) {
    console.error("❌ getVenuesWithClassesFromBookings Error:", error.message);
    return { status: false, message: error.message };
  }
};
