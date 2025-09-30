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
  Feedback,
} = require("../../../models");
const { Op } = require("sequelize");

exports.getAllStudentsListing = async (filters = {}) => {
  try {
    const students = await BookingStudentMeta.findAll({
      include: [
        { model: BookingParentMeta, as: "parents", required: false },
        {
          model: BookingEmergencyMeta,
          as: "emergencyContacts",
          required: false,
        },
      ],
    });

    const grouped = {};

    students.forEach((student) => {
      const trialId = student.bookingTrialId;

      if (!grouped[trialId]) {
        const parents = (student.parents || []).map((p) => ({
          id: p.id,
          studentId: p.studentId,
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        }));

        const emergency = (student.emergencyContacts || []).map((e) => ({
          id: e.id,
          studentId: e.studentId,
          emergencyFirstName: e.emergencyFirstName,
          emergencyLastName: e.emergencyLastName,
          emergencyPhoneNumber: e.emergencyPhoneNumber,
          emergencyRelation: e.emergencyRelation,
        }));

        grouped[trialId] = {
          bookingTrialId: trialId,
          students: [],
          parents,
          emergency,
        };
      }

      grouped[trialId].students.push({
        id: student.id,
        studentFirstName: student.studentFirstName,
        studentLastName: student.studentLastName,
        dateOfBirth: student.dateOfBirth,
        age: student.age,
        gender: student.gender,
        medicalInformation: student.medicalInformation,
      });
    });

    return {
      status: true,
      message: "Bookings retrieved successfully",
      data: {
        accountInformation: Object.values(grouped),
      },
    };
  } catch (error) {
    console.error("❌ getAllStudentsListing Error:", error.message);
    return { status: false, message: error.message };
  }
};
exports.getStudentById = async (studentId) => {
  try {
    if (!studentId) {
      return { status: false, message: "Student ID is required" };
    }

    const student = await BookingStudentMeta.findOne({
      where: { id: studentId },
      include: [
        { model: BookingParentMeta, as: "parents", required: false },
        {
          model: BookingEmergencyMeta,
          as: "emergencyContacts",
          required: false,
        },
      ],
    });

    if (!student) {
      return { status: false, message: "Student not found" };
    }

    // Map parents and emergency contacts safely
    const parents = (student.parents || []).map((p) => ({
      id: p.id,
      studentId: p.studentId,
      parentFirstName: p.parentFirstName,
      parentLastName: p.parentLastName,
      parentEmail: p.parentEmail,
      parentPhoneNumber: p.parentPhoneNumber,
      relationToChild: p.relationToChild,
      howDidYouHear: p.howDidYouHear,
    }));

    const emergency = (student.emergencyContacts || []).map((e) => ({
      id: e.id,
      studentId: e.studentId,
      emergencyFirstName: e.emergencyFirstName,
      emergencyLastName: e.emergencyLastName,
      emergencyPhoneNumber: e.emergencyPhoneNumber,
      emergencyRelation: e.emergencyRelation,
    }));

    // Wrap in same format as accountInformation
    const accountInformation = {
      bookingTrialId: student.bookingTrialId,
      students: [
        {
          id: student.id,
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
        },
      ],
      parents,
      emergency,
    };

    return {
      status: true,
      message: "Student retrieved successfully",
      data: { accountInformation },
    };
  } catch (error) {
    console.error("❌ getStudentById Error:", error.message);
    return { status: false, message: error.message };
  }
};
exports.updateBookingInformationByTrialId = async (
  bookingTrialId,
  updateData
) => {
  try {
    // 🔹 Fetch existing students
    const existingStudents = await BookingStudentMeta.findAll({
      where: { bookingTrialId },
    });

    const existingStudentIds = existingStudents.map((s) => s.id);
    const payloadStudentIds = (updateData.students || [])
      .filter((s) => s.id)
      .map((s) => s.id);

    // 🔹 Remove students not included in payload (optional clean-up)
    const toDelete = existingStudentIds.filter(
      (id) => !payloadStudentIds.includes(id)
    );
    if (toDelete.length > 0) {
      await BookingStudentMeta.destroy({ where: { id: toDelete } });
    }

    let firstStudentId = null;

    // 🔹 Upsert Students
    for (const [index, student] of (updateData.students || []).entries()) {
      let studentId = student.id;

      if (studentId) {
        await BookingStudentMeta.update(student, { where: { id: studentId } });
      } else {
        const newStudent = await BookingStudentMeta.create({
          ...student,
          bookingTrialId, // ✅ ensure FK
        });
        studentId = newStudent.id;
      }

      if (index === 0) {
        firstStudentId = studentId; // for emergencies
      }

      // 🔹 Parents (linked to each student)
      if (updateData.parents) {
        for (const parent of updateData.parents) {
          if (parent.id) {
            await BookingParentMeta.update(parent, {
              where: { id: parent.id },
            });
          } else {
            await BookingParentMeta.create({
              ...parent,
              studentId,
            });
          }
        }
      }
    }

    // 🔹 Emergency (linked only to first student of trial)
    if (updateData.emergency && firstStudentId) {
      for (const emergency of updateData.emergency) {
        if (emergency.id) {
          await BookingEmergencyMeta.update(emergency, {
            where: { id: emergency.id },
          });
        } else {
          await BookingEmergencyMeta.create({
            ...emergency,
            studentId: firstStudentId,
          });
        }
      }
    }

    return {
      status: true,
      message: "Account Information updated successfully",
    };
  } catch (error) {
    console.error("❌ updateBookingTrialById Error:", error.message);
    return { status: false, message: error.message };
  }
};
// AccountInformationService.getBookingsById
exports.getBookingsById = async (bookingId, filters = {}) => {
  try {
    // ✅ Base where clause
    const whereClause = { id: bookingId };

    // ✅ Include only relevant statuses
    whereClause.status = { [Op.or]: ["waiting list", "paid", "active"] };

    if (filters.fromDate && filters.toDate) {
      const fromDate = new Date(filters.fromDate);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = new Date(filters.toDate);
      toDate.setHours(23, 59, 59, 999);

      whereClause.createdAt = {
        [Op.between]: [fromDate, toDate],
      };
    }

    // ✅ Fetch bookings
    const bookings = await Booking.findAll({
      where: whereClause,
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
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          include: [{ model: Venue, as: "venue", required: false }],
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
      ],
    });

    // ✅ If no bookings found, return empty arrays
    if (!bookings.length) {
      return {
        status: true,
        message: "Booking retrieved successfully",
        data: {
          weeklyClasses: [],
          club: [],
          merchandise: [],
          oneToOne: [],
          allPurchased: [],
          birthday: [],
        },
      };
    }

    // ✅ Parse bookings
    const parsedBookings = bookings.map((booking) => {
      const students =
        booking.students?.map((s) => ({
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
        ) || [];

      const venue = booking.classSchedule?.venue || null;
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
        })) || [];

      const payment = payments[0] || null;

      return {
        bookingId: booking.id,
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
      };
    });

    // ✅ Build response arrays based on type filter
    let responseData = {
      weeklyClasses: [],
      club: [],
      merchandise: [],
      oneToOne: [],
      allPurchased: [],
      birthday: [],
    };

    const type = filters.type?.toLowerCase() || "all";

    if (type === "weeklyclasses") {
      responseData = { weeklyClasses: parsedBookings };
    } else if (type === "club") {
      responseData = { club: [] }; // no data yet for club
    } else if (type == "merchandise") {
      responseData = { merchandise: [] };
    } else if (type == "oneToOne") {
      responseData = { oneToOne: [] };
    } else if (type == "allPurchased") {
      responseData = { allPurchased: [] };
    } else if (type == "birthday") {
      responseData = { birthday: [] };
    } else if (type === "all") {
      responseData = {
        weeklyClasses: parsedBookings,
        club: [], // still empty
        merchandise: [],
        oneToOne: [],
        allPurchased: [],
        birthday: [],
      };
    }

    return {
      status: true,
      message: "Booking retrieved successfully",
      data: responseData,
    };
  } catch (error) {
    console.error("❌ getBookingsById Error:", error);
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

exports.createFeedbackById = async (feedbackData) => {
  try {
    const {
      bookingId,
      classScheduleId,
      feedbackType,
      category,
      reason,
      agentAssigned,
      status,
      resolutionNote,
    } = feedbackData;

    // ✅ Validation for required fields
    if (!bookingId || !classScheduleId || !feedbackType || !category) {
      return {
        status: false,
        message:
          "bookingId, classScheduleId, feedbackType, and category are required",
      };
    }

    // ✅ Create feedback
    const feedback = await Feedback.create({
      bookingId,
      classScheduleId,
      feedbackType,
      category,
      reason: reason || null,
      agentAssigned: agentAssigned || null,
      status: status || "in_process",
      resolutionNote: resolutionNote || null,
    });

    return {
      status: true,
      message: "Feedback created successfully",
      data: feedback,
    };
  } catch (error) {
    console.error("❌ createFeedbackById Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.listAllFeedbacks = async (bookingId = null) => {
  try {
    console.log("🔹 Step 1: Fetching all feedbacks from DB...");

    const whereClause = {};
    if (bookingId) whereClause.bookingId = bookingId;

    const feedbacks = await Feedback.findAll({
      where: whereClause,
      include: [
        {
          model: Booking,
          as: "booking",
          attributes: ["id", "bookedBy", "status"],
          include: [
            {
              model: Admin, // your Admins table/model
              as: "bookedByAdmin", // association alias
              attributes: ["id", "firstName", "lastName", "email"],
            },
          ],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          attributes: ["id", "className", "startTime", "endTime", "day"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Format the response
    const formattedFeedbacks = feedbacks.map((fb) => {
      const fbJson = fb.toJSON();
      return {
        ...fbJson,
        bookedBy: fbJson.booking?.bookedByAdmin || null, // flatten bookedBy
      };
    });

    console.log(
      `✅ Step 2: Retrieved ${formattedFeedbacks.length} feedback(s)`
    );

    return {
      status: true,
      message: "All feedbacks retrieved successfully",
      data: formattedFeedbacks,
    };
  } catch (error) {
    console.error("❌ listAllFeedbacks Service Error:", error.message);
    return { status: false, message: error.message };
  }
};
exports.getFeedbackById = async (id) => {
  try {
    console.log(`🔹 Step 1: Fetching feedback with id=${id}...`);

    const feedback = await Feedback.findOne({
      where: { id },
      include: [
        {
          model: Booking,
          as: "booking",
          attributes: ["id", "bookedBy", "status"],
          include: [
            {
              model: Admin,
              as: "bookedByAdmin",
              attributes: ["id", "firstName", "lastName", "email"],
            },
          ],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          attributes: ["id", "className", "startTime", "endTime", "day"],
        },
      ],
    });

    if (!feedback) {
      console.warn(`⚠️ Feedback not found for id=${id}`);
      return { status: false, message: "Feedback not found" };
    }

    // Flatten bookedBy like in listAllFeedbacks
    const fbJson = feedback.toJSON();
    const formattedFeedback = {
      ...fbJson,
      bookedBy: fbJson.booking?.bookedByAdmin || null,
    };

    console.log(`✅ Step 2: Found feedback with id=${id}`);

    return {
      status: true,
      message: "Feedback retrieved successfully",
      data: formattedFeedback,
    };
  } catch (error) {
    console.error("❌ getFeedbackById Service Error:", error.message);
    return { status: false, message: error.message };
  }
};
exports.updateFeedbackStatus = async (id, newStatus = "resolved") => {
  try {
    console.log(
      `🔹 Step 1: Updating feedback id=${id} to status=${newStatus}...`
    );

    const feedback = await Feedback.findByPk(id);
    if (!feedback) {
      console.warn(`⚠️ Feedback not found for id=${id}`);
      return { status: false, message: "Feedback not found" };
    }

    // Update status
    feedback.status = newStatus;
    await feedback.save();

    console.log(`✅ Step 2: Feedback id=${id} updated to status=${newStatus}`);

    return {
      status: true,
      message: "Feedback status updated successfully",
      data: feedback,
    };
  } catch (error) {
    console.error("❌ updateFeedbackStatus Service Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getEventsByBookingId = async (bookingId) => {
  try {
    console.log(
      `🔹 Step 1: Fetching booking details for bookingId=${bookingId}...`
    );

    const booking = await Booking.findOne({
      where: { id: bookingId },
      include: [
        {
          model: Admin,
          as: "bookedByAdmin", // who booked
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
        },
        {
          model: Venue,
          as: "venue",
        },
        {
          model: Feedback,
          as: "feedbacks",
        },
      ],
    });

    if (!booking) {
      console.warn(`⚠️ No booking found with id=${bookingId}`);
      return {
        status: false,
        message: "No booking found with this ID.",
        data: null,
      };
    }

    console.log(`✅ Step 2: Found booking with id=${bookingId}`);

    return {
      status: true,
      message: "Booking retrieved successfully",
      data: booking,
    };
  } catch (error) {
    console.error("❌ getEventsByBookingId Service Error:", error.message);
    return { status: false, message: error.message, data: null };
  }
};
