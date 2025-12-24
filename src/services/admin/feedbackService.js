const {
  Booking,
  ClassSchedule,
  Venue,
  Feedback,
  Admin,
  AdminRole,
  OneToOneBooking,
  BirthdayPartyBooking,
  HolidayClassSchedule,
  HolidayBooking,
  HolidayVenue,
} = require("../../models");
const { Op } = require("sequelize");

exports.createFeedbackById = async (feedbackData, transaction = null) => {
  try {
    const {
      bookingId,
      oneToOneBookingId,
      birthdayPartyBookingId,
      holidayBookingId,

      classScheduleId,
      holidayClassScheduleId,

      serviceType,
      feedbackType,
      category,
      notes,
      agentAssigned,
      status,
      createdBy,
    } = feedbackData;

    let venueId = null;
    let holidayVenueId = null;

    // 🔹 HOLIDAY CAMP
    if (serviceType === "holiday camp") {
      if (!holidayClassScheduleId) {
        return {
          status: false,
          message: "holidayClassScheduleId is required for holiday camp",
        };
      }

      const holidaySchedule = await HolidayClassSchedule.findByPk(
        holidayClassScheduleId,
        {
          attributes: ["id", "holidayVenueId"],
          transaction,
        }
      );

      if (!holidaySchedule || !holidaySchedule.holidayVenueId) {
        return {
          status: false,
          message: "Invalid holidayClassScheduleId or venue not assigned",
        };
      }

      holidayVenueId = holidaySchedule.holidayVenueId;
    }

    // 🔹 ALL NON-HOLIDAY SERVICES
    else {
      if (!classScheduleId) {
        return {
          status: false,
          message: "classScheduleId is required",
        };
      }

      const classSchedule = await ClassSchedule.findByPk(classScheduleId, {
        attributes: ["id", "venueId"],
        transaction,
      });

      if (!classSchedule || !classSchedule.venueId) {
        return {
          status: false,
          message: "Invalid classScheduleId or venue not assigned",
        };
      }

      venueId = classSchedule.venueId;
    }

    // 🔹 CREATE FEEDBACK
    const feedback = await Feedback.create(
      {
        // booking mappings
        bookingId:
          serviceType.includes("weekly") ? bookingId : null,

        oneToOneBookingId:
          serviceType === "one to one" ? oneToOneBookingId : null,

        birthdayPartyBookingId:
          serviceType === "birthday party"
            ? birthdayPartyBookingId
            : null,

        holidayBookingId:
          serviceType === "holiday camp" ? holidayBookingId : null,

        serviceType,

        // schedules
        classScheduleId:
          serviceType === "holiday camp" ? null : classScheduleId,

        venueId:
          serviceType === "holiday camp" ? null : venueId,

        holidayClassScheduleId:
          serviceType === "holiday camp"
            ? holidayClassScheduleId
            : null,

        holidayVenueId:
          serviceType === "holiday camp" ? holidayVenueId : null,

        feedbackType,
        category,
        notes: notes || null,
        agentAssigned: agentAssigned || null,
        status: status || "in_process",
        createdBy,
      },
      { transaction }
    );

    return {
      status: true,
      message: "Feedback created successfully",
      data: feedback,
    };
  } catch (error) {
    console.error("❌ createFeedbackById Error:", error);
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.getAllFeedbacks = async (adminId, superAdminId) => {
  if (!adminId || isNaN(Number(adminId))) {
    return {
      status: false,
      message: "No valid Admin or SuperAdmin.",
      data: {},
    };
  }

  try {
    let whereCondition = {};

    // 🔐 SUPER ADMIN → all feedbacks
    if (superAdminId && Number(adminId) === Number(superAdminId)) {
      whereCondition = {};
    }
    // 🔐 NORMAL ADMIN → own + super admin feedbacks
    else {
      whereCondition = {
        createdBy: {
          [Op.in]: [Number(adminId), Number(superAdminId)],
        },
      };
    }

    const feedbacks = await Feedback.findAll({
      where: whereCondition,
      include: [
        {
          model: Booking,
          as: "booking",
          attributes: ["id", "status"],
          required: false,
        },
        {
          model: OneToOneBooking,
          as: "oneToOneBooking",
          attributes: ["id", "status"],
          required: false,
        },
        {
          model: BirthdayPartyBooking,
          as: "birthdayPartyBooking",
          attributes: ["id", "status"],
          required: false,
        },
        {
          model: HolidayBooking,
          as: "holidayBooking",
          attributes: ["id", "status"],
          required: false,
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          // attributes: ["id", "className", "startTime", "endTime"],
          required: false,
        },
        {
          model: HolidayClassSchedule,
          as: "holidayClassSchedule",
          // attributes: ["id", "startDate", "endDate"],
          required: false,
        },
        {
          model: Venue,
          as: "venue",
          attributes: ["id", "name"],
          required: false,
        },
        {
          model: HolidayVenue,
          as: "holidayVenue",
          attributes: ["id", "name"],
          required: false,
        },
        {
          model: Admin,
          as: "creator",
          attributes: ["id", "firstName", "lastName"],
        },
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // 🔹 GROUP STRICTLY BY ENUM VALUES
    const groupedFeedbacks = feedbacks.reduce(
      (acc, feedback) => {
        const type = feedback.serviceType;

        if (!acc[type]) {
          acc[type] = [];
        }

        acc[type].push(feedback);
        return acc;
      },
      {
        "weekly class membership": [],
        "weekly class trial": [],
        "one to one": [],
        "birthday party": [],
        "holiday camp": [],
      }
    );

    return {
      status: true,
      message: "All feedbacks retrieved successfully",
      data: groupedFeedbacks,
    };
  } catch (error) {
    console.error("❌ getAllFeedbacks Service Error:", error);
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.getFeedbackById = async (id, adminId, superAdminId) => {
  try {
    if (!id || isNaN(Number(id))) {
      return {
        status: false,
        message: "Invalid feedback ID",
      };
    }

    let whereCondition = { id: Number(id) };

    // 🔐 Normal Admin → own + super admin only
    if (Number(adminId) !== Number(superAdminId)) {
      whereCondition.createdBy = {
        [Op.in]: [Number(adminId), Number(superAdminId)],
      };
    }
    // 🔐 Super Admin → unrestricted (no extra filter)

    const feedback = await Feedback.findOne({
      where: whereCondition,
      include: [
        {
          model: Booking,
          as: "booking",
          attributes: ["id", "status"],
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
          attributes: ["id", "className", "startTime", "endTime"],
        },
        {
          model: Venue,
          as: "venue",
          attributes: ["id", "name"],
        },
        {
          model: Admin,
          as: "creator",
          attributes: ["id", "firstName", "lastName"],
        },
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    if (!feedback) {
      return {
        status: false,
        message: "Feedback not found or access denied",
      };
    }

    return {
      status: true,
      message: "Feedback retrieved successfully",
      data: feedback,
    };
  } catch (error) {
    console.error("❌ getFeedbackById Service Error:", error);
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.updateFeedbackStatus = async (
  feedbackId,
  newStatus = "resolved",
  agentAssigned = null
) => {
  try {
    const feedback = await Feedback.findByPk(feedbackId);

    if (!feedback) {
      return {
        status: false,
        message: "Feedback not found",
      };
    }

    // -------------------------
    // Update fields
    // -------------------------
    feedback.status = newStatus;

    // 👇 Update agentAssigned ONLY if provided
    if (agentAssigned !== undefined && agentAssigned !== null) {
      feedback.agentAssigned = agentAssigned;
    }

    await feedback.save();

    return {
      status: true,
      message: "Feedback status updated successfully",
      data: feedback,
    };
  } catch (error) {
    console.error("❌ updateFeedbackStatus Error:", error.message);
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.getAgentsAndClasses = async (superAdminId) => {
  if (!superAdminId || isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "Invalid Super Admin ID.",
      data: {
        agents: [],
        classSchedules: [],
      },
    };
  }

  try {
    /* 🔹 FETCH AGENTS */
    const agents = await Admin.findAll({
      where: {
        [Op.or]: [
          { superAdminId: Number(superAdminId) },
          { id: Number(superAdminId) },
        ],
      },
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: {
            role: { [Op.in]: ["admin", "super admin"] },
          },
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    /* 🔹 FETCH CLASS SCHEDULES */
    const classSchedules = await ClassSchedule.findAll({
      where: {
        createdBy: Number(superAdminId),
        venueId: { [Op.ne]: null },
      },
      include: [
        {
          model: Venue,
          as: "venue",
          required: true,
        },
      ],
      order: [["id", "ASC"]],
    });

    return {
      status: true,
      message: "Fetched agents and class schedules successfully.",
      data: {
        agents,
        classSchedules,
      },
    };
  } catch (error) {
    console.error("❌ getAgentsAndClasses Service Error:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch agents and classes.",
    };
  }
};

// exports.getEventsByBookingId = async (bookingId) => {
//     try {
//         console.log(
//             `🔹 Step 1: Fetching booking details for bookingId=${bookingId}...`
//         );

//         const booking = await Booking.findOne({
//             where: { id: bookingId },
//             include: [
//                 {
//                     model: Admin,
//                     as: "bookedByAdmin", // who booked
//                 },
//                 {
//                     model: ClassSchedule,
//                     as: "classSchedule",
//                 },
//                 {
//                     model: Venue,
//                     as: "venue",
//                 },
//                 {
//                     model: Feedback,
//                     as: "feedbacks",
//                 },
//             ],
//         });

//         if (!booking) {
//             console.warn(`⚠️ No booking found with id=${bookingId}`);
//             return {
//                 status: false,
//                 message: "No booking found with this ID.",
//                 data: null,
//             };
//         }

//         console.log(`✅ Step 2: Found booking with id=${bookingId}`);

//         return {
//             status: true,
//             message: "Booking retrieved successfully",
//             data: booking,
//         };
//     } catch (error) {
//         console.error("❌ getEventsByBookingId Service Error:", error.message);
//         return { status: false, message: error.message, data: null };
//     }
// };
