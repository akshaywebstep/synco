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
      createdByParent,
      role,
    } = feedbackData;

    let venueId = null;
    let holidayVenueId = null;

    // For holiday camp, validate holidayClassScheduleId & fetch venueId
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
          attributes: ["id", "venueId"],
          transaction,
        }
      );

      if (!holidaySchedule || !holidaySchedule.venueId) {
        return {
          status: false,
          message: "Invalid holidayClassScheduleId or venue not assigned",
        };
      }

      holidayVenueId = holidaySchedule.venueId;
    }
    // For weekly classes, validate classScheduleId & fetch venueId
    else if (
      serviceType === "weekly class membership" ||
      serviceType === "weekly class trial"
    ) {
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
    // For "one to one" and "birthday party" skip classScheduleId and venueId

    // 🔹 CREATE FEEDBACK
    const feedback = await Feedback.create(
      {
        bookingId:
          serviceType.includes("weekly") ? bookingId : null,

        oneToOneBookingId:
          serviceType === "one to one" ? oneToOneBookingId : null,

        birthdayPartyBookingId:
          serviceType === "birthday party" ? birthdayPartyBookingId : null,

        holidayBookingId:
          serviceType === "holiday camp" ? holidayBookingId : null,

        serviceType,

        classScheduleId:
          serviceType === "holiday camp" ||
            serviceType === "one to one" ||
            serviceType === "birthday party"
            ? null
            : classScheduleId,

        venueId:
          serviceType === "holiday camp" ||
            serviceType === "one to one" ||
            serviceType === "birthday party"
            ? null
            : venueId,

        holidayClassScheduleId:
          serviceType === "holiday camp" ? holidayClassScheduleId : null,

        holidayVenueId:
          serviceType === "holiday camp" ? holidayVenueId : null,

        feedbackType,
        category,
        notes: notes || null,
        agentAssigned: agentAssigned || null,
        status: status || "in_process",
        createdBy,
        createdByParent,
        role,
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

exports.getAllFeedbacks = async (userId, role, superAdminId) => {
  if (!userId || isNaN(Number(userId))) {
    return {
      status: false,
      message: "Invalid user ID",
      data: {},
    };
  }

  try {
    let whereCondition = {};

    if (role === "Admin") {
      // Show:
      // 1) Feedbacks created by this admin
      // 2) Feedbacks created by any parent (createdByParent IS NOT NULL)
      whereCondition = {
        [Op.or]: [
          { createdBy: Number(userId) },
          { createdByParent: { [Op.ne]: null } }, // any parent-created feedback
        ],
      };
    } else if (role === "Parents") {
      // Show:
      // 1) Feedbacks created by this parent (createdByParent)
      // 2) Feedbacks created by the super admin (createdBy)
      whereCondition = {
        [Op.or]: [
          { createdByParent: Number(userId) },
          { createdBy: superAdminId ? Number(superAdminId) : null },
        ].filter(Boolean),
      };
    } else {
      // fallback, just show user's own feedbacks
      whereCondition = {
        createdBy: Number(userId),
      };
    }

    const feedbacks = await Feedback.findAll({
      where: whereCondition,
      include: [
        { model: Booking, as: "booking", attributes: ["id", "status"], required: false },
        { model: OneToOneBooking, as: "oneToOneBooking", required: false },
        { model: BirthdayPartyBooking, as: "birthdayPartyBooking", required: false },
        { model: HolidayBooking, as: "holidayBooking", attributes: ["id", "status"], required: false },
        { model: ClassSchedule, as: "classSchedule", required: false },
        { model: HolidayClassSchedule, as: "holidayClassSchedule", required: false },
        { model: Venue, as: "venue", attributes: ["id", "name"], required: false },
        { model: HolidayVenue, as: "holidayVenue", attributes: ["id", "name"], required: false },
        { model: Admin, as: "creator", attributes: ["id", "firstName", "lastName"] },
        { model: Admin, as: "assignedAgent", attributes: ["id", "firstName", "lastName"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const validServiceTypes = new Set([
      "weekly class membership",
      "weekly class trial",
      "one to one",
      "birthday party",
      "holiday camp",
    ]);

    const groupedFeedbacks = feedbacks.reduce((acc, feedback) => {
      const type = feedback.serviceType;
      if (validServiceTypes.has(type)) {
        acc[type].push(feedback);
      }
      // else ignore feedbacks with serviceType not in valid keys (including empty string)
      return acc;
    }, {
      "weekly class membership": [],
      "weekly class trial": [],
      "one to one": [],
      "birthday party": [],
      "holiday camp": [],
    });

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

// exports.getAllFeedbacks = async (createdBy) => {
//   if (!createdBy || isNaN(Number(createdBy))) {
//     return {
//       status: false,
//       message: "Invalid admin",
//       data: {},
//     };
//   }

//   try {
//     const feedbacks = await Feedback.findAll({
//       where: { createdBy: Number(createdBy) },
//       include: [
//         { model: Booking, as: "booking", attributes: ["id", "status"], required: false },
//         { model: OneToOneBooking, as: "oneToOneBooking", required: false },
//         { model: BirthdayPartyBooking, as: "birthdayPartyBooking", required: false },
//         { model: HolidayBooking, as: "holidayBooking", attributes: ["id", "status"], required: false },
//         { model: ClassSchedule, as: "classSchedule", required: false },
//         { model: HolidayClassSchedule, as: "holidayClassSchedule", required: false },
//         { model: Venue, as: "venue", attributes: ["id", "name"], required: false },
//         { model: HolidayVenue, as: "holidayVenue", attributes: ["id", "name"], required: false },
//         { model: Admin, as: "creator", attributes: ["id", "firstName", "lastName"] },
//         { model: Admin, as: "assignedAgent", attributes: ["id", "firstName", "lastName"] },
//       ],
//       order: [["createdAt", "DESC"]],
//     });

//     // 🔹 GROUP BY serviceType (SAFE ENUM GROUPING)
//     const groupedFeedbacks = feedbacks.reduce(
//       (acc, feedback) => {
//         const type = feedback.serviceType;
//         if (!acc[type]) acc[type] = [];
//         acc[type].push(feedback);
//         return acc;
//       },
//       {
//         "weekly class membership": [],
//         "weekly class trial": [],
//         "one to one": [],
//         "birthday party": [],
//         "holiday camp": [],
//       }
//     );

//     return {
//       status: true,
//       message: "All feedbacks retrieved successfully",
//       data: groupedFeedbacks,
//     };
//   } catch (error) {
//     console.error("❌ getAllFeedbacks Service Error:", error);
//     return {
//       status: false,
//       message: error.message,
//     };
//   }
// };

// exports.getFeedbackById = async (feedbackId, createdBy) => {
//   if (!createdBy || isNaN(Number(createdBy))) {
//     return {
//       status: false,
//       message: "Invalid Admin ",
//     };
//   }
//   if (!feedbackId || isNaN(Number(feedbackId))) {
//     return {
//       status: false,
//       message: "Invalid feedback",
//     };
//   }

//   try {
//     const feedback = await Feedback.findOne({
//       where: { id, createdBy: Number(createdBy) },
//       include: [
//         {
//           model: Booking,
//           as: "booking",
//           attributes: ["id", "status"],
//           required: false,
//         },
//         {
//           model: OneToOneBooking,
//           as: "oneToOneBooking",
//           attributes: ["id", "status"],
//           required: false,
//         },
//         {
//           model: BirthdayPartyBooking,
//           as: "birthdayPartyBooking",
//           // attributes: ["id", "status"],
//           required: false,
//         },
//         {
//           model: HolidayBooking,
//           as: "holidayBooking",
//           // attributes: ["id", "status"],
//           required: false,
//         },
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           required: false,
//         },
//         {
//           model: HolidayClassSchedule,
//           as: "holidayClassSchedule",
//           required: false,
//         },
//         {
//           model: Venue,
//           as: "venue",
//           attributes: ["id", "name"],
//           required: false,
//         },
//         {
//           model: HolidayVenue,
//           as: "holidayVenue",
//           attributes: ["id", "name"],
//           required: false,
//         },
//         {
//           model: Admin,
//           as: "creator",
//           attributes: ["id", "firstName", "lastName"],
//         },
//         {
//           model: Admin,
//           as: "assignedAgent",
//           attributes: ["id", "firstName", "lastName"],
//         },
//       ],
//     });

//     if (!feedback) {
//       return {
//         status: false,
//         message: "Feedback not found or access denied",
//       };
//     }

//     return {
//       status: true,
//       message: "Feedback retrieved successfully",
//       data: feedback,
//     };
//   } catch (error) {
//     console.error("❌ getFeedbackById Service Error:", error);
//     return {
//       status: false,
//       message: error.message,
//     };
//   }
// };

exports.getFeedbackById = async (feedbackId, userId, role, superAdminId) => {
  if (!userId || isNaN(Number(userId))) {
    return {
      status: false,
      message: "Invalid user ID",
    };
  }
  if (!feedbackId || isNaN(Number(feedbackId))) {
    return {
      status: false,
      message: "Invalid feedback ID",
    };
  }

  try {
    let whereCondition = { id: Number(feedbackId) };

    if (role === "Admin") {
      // Only allow if created by this admin OR created by any parent (like in getAllFeedbacks)
      whereCondition = {
        ...whereCondition,
        [Op.or]: [
          { createdBy: Number(userId) },
          { createdByParent: { [Op.ne]: null } },
        ],
      };
    } else if (role === "Parents") {
      // Allow if created by this parent OR created by super admin
      whereCondition = {
        ...whereCondition,
        [Op.or]: [
          { createdByParent: Number(userId) },
          { createdBy: superAdminId ? Number(superAdminId) : null },
        ].filter(Boolean),
      };
    } else {
      // fallback - only allow if created by userId
      whereCondition = {
        ...whereCondition,
        createdBy: Number(userId),
      };
    }

    const feedback = await Feedback.findOne({
      where: whereCondition,
      include: [
        { model: Booking, as: "booking", attributes: ["id", "status"], required: false },
        { model: OneToOneBooking, as: "oneToOneBooking", attributes: ["id", "status"], required: false },
        { model: BirthdayPartyBooking, as: "birthdayPartyBooking", required: false },
        { model: HolidayBooking, as: "holidayBooking", required: false },
        { model: ClassSchedule, as: "classSchedule", required: false },
        { model: HolidayClassSchedule, as: "holidayClassSchedule", required: false },
        { model: Venue, as: "venue", attributes: ["id", "name"], required: false },
        { model: HolidayVenue, as: "holidayVenue", attributes: ["id", "name"], required: false },
        { model: Admin, as: "creator", attributes: ["id", "firstName", "lastName"] },
        { model: Admin, as: "assignedAgent", attributes: ["id", "firstName", "lastName"] },
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

exports.getAgentsAndHolidayClasses = async (superAdminId) => {
  if (!superAdminId || Number.isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "Invalid Super Admin ID.",
      data: {
        agents: [],
        holidayClassSchedules: [],
      },
    };
  }

  try {
    const parsedSuperAdminId = Number(superAdminId);

    /* 🔹 FETCH AGENTS */
    const agentsRaw = await Admin.findAll({
      where: {
        [Op.or]: [
          { superAdminId: parsedSuperAdminId },
          { id: parsedSuperAdminId },
        ],
      },
      attributes: {
        exclude: ["password", "resetOtp", "resetOtpExpiry", "deletedAt"],
      },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: {
            role: { [Op.in]: ["admin", "super admin"] },
          },
          required: true,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    /* 🔹 FETCH HOLIDAY CLASS SCHEDULES */
    const holidayClassesRaw = await HolidayClassSchedule.findAll({
      where: {
        createdBy: parsedSuperAdminId,
        venueId: { [Op.not]: null },
      },
      include: [
        {
          model: HolidayVenue,
          as: "venue",
          required: true,
          attributes: { exclude: ["deletedAt"] },
        },
      ],
      attributes: { exclude: ["deletedAt"] },
      order: [["id", "ASC"]],
    });

    /* 🔹 REMOVE NULL FIELDS (CLEAN RESPONSE) */
    const clean = (data) =>
      JSON.parse(
        JSON.stringify(data, (_, value) =>
          value === null || value === undefined ? undefined : value
        )
      );

    return {
      status: true,
      message: "Fetched agents and holiday class schedules successfully.",
      data: {
        agents: clean(agentsRaw),
        holidayClassSchedules: clean(holidayClassesRaw),
      },
    };
  } catch (error) {
    console.error("❌ getAgentsAndHolidayClasses Service Error:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch agents and holiday class schedules.",
      data: {
        agents: [],
        holidayClassSchedules: [],
      },
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
