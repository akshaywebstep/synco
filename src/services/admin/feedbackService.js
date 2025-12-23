const {
  Booking,
  ClassSchedule,
  Venue,
  Feedback,
  Admin,
  AdminRole,
} = require("../../models");
const { Op } = require("sequelize");

exports.createFeedbackById = async (feedbackData, transaction = null) => {
  try {
    const {
      bookingId,
      classScheduleId,
      feedbackType,
      notes,
      category,
      agentAssigned,
      status,
      createdBy,
    } = feedbackData;

    // 🔹 Step 1: Fetch ClassSchedule → Venue
    const classSchedule = await ClassSchedule.findByPk(classScheduleId, {
      attributes: ["id", "venueId"],
      transaction,
    });

    if (!classSchedule) {
      return {
        status: false,
        message: "Invalid classScheduleId",
      };
    }

    if (!classSchedule.venueId) {
      return {
        status: false,
        message: "Venue not assigned to this class schedule",
      };
    }

    // 🔹 Step 2: Create feedback with derived venueId
    const feedback = await Feedback.create(
      {
        bookingId,
        classScheduleId,
        venueId: classSchedule.venueId, // ✅ AUTO SET
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
    return { status: false, message: error.message };
  }
};

exports.getAllFeedbacks = async (adminId, superAdminId) => {
  if (!adminId || isNaN(Number(adminId))) {
    return {
      status: false,
      message: "No valid Admin or SuperAdmin.",
      data: [],
    };
  }

  try {
    let whereCondition = {};

    // 🔐 If SUPER ADMIN (adminId === superAdminId)
    if (superAdminId && Number(adminId) === Number(superAdminId)) {
      whereCondition = {
        createdBy: {
          [Op.or]: [
            Number(adminId), // super admin
            { [Op.ne]: null } // all child admins (optional)
          ]
        }
      };
    }
    // 🔐 NORMAL ADMIN
    else {
      whereCondition = {
        createdBy: {
          [Op.in]: [
            Number(adminId),      // own feedback
            Number(superAdminId), // super admin feedback
          ],
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
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: "All feedbacks retrieved successfully",
      data: feedbacks,
    };
  } catch (error) {
    console.error("❌ getAllFeedbacks Service Error:", error);
    return { status: false, message: error.message };
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

exports.getAllAgent = async (superAdminId, includeSuperAdmin = false) => {
  if (!superAdminId || isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "No valid Agent found for this request.",
      data: [],
    };
  }

  try {
    const whereCondition = includeSuperAdmin
      ? {
        [Op.or]: [
          { superAdminId: Number(superAdminId) },
          { id: Number(superAdminId) },
        ],
      }
      : { superAdminId: Number(superAdminId) };

    const admins = await Admin.findAll({
      where: whereCondition,
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: {
            role: {
              [Op.in]: ["admin", "super admin"],
            },
          },
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} agent(s) successfully.`,
      data: admins,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAssignedAgent:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch agents.",
    };
  }
};
exports.getAllClasses = async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid Admin or SuperAdmin.",
        data: [],
      };
    }

    const classes = await ClassSchedule.findAll({
      where: {
        createdBy: Number(adminId),
        venueId: { [Op.ne]: null }, // extra safety
      },
      order: [["id", "ASC"]],
      include: [
        {
          model: Venue,
          as: "venue",
          required: true, // 🔥 ONLY classes with venue
        },
      ],
    });

    return {
      status: true,
      message: "Fetched class schedules successfully.",
      data: classes,
    };
  } catch (error) {
    console.error("❌ getAllClasses Error:", error);
    return { status: false, message: error.message };
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
