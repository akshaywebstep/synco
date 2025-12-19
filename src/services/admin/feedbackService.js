const {
    Booking,
    ClassSchedule,
    Venue,
    Feedback,
    Admin,
} = require("../../models");

exports.createFeedbackById = async (feedbackData, transaction = null) => {
    try {
        const {
            bookingId,
            title,
            classScheduleId,
            feedbackType,
            category,
            reason,
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
                title,
                classScheduleId,
                venueId: classSchedule.venueId, // ✅ AUTO SET
                feedbackType,
                category,
                reason: reason || null,
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

exports.getAllFeedbacks = async () => {
  try {
    const feedbacks = await Feedback.findAll({
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
          as: "creator",          // ✅ Feedback → createdBy
          attributes: ["id", "firstName", "lastName"],
        },
        {
          model: Admin,
          as: "assignedAgent",    // ✅ Feedback → agentAssigned
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
    console.error("❌ getAllFeedbacks Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getFeedbackById = async (id) => {
  try {
    const feedback = await Feedback.findOne({
      where: { id },
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
          as: "creator",          // Feedback.createdBy
          attributes: ["id", "firstName", "lastName"],
        },
        {
          model: Admin,
          as: "assignedAgent",    // Feedback.agentAssigned
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    if (!feedback) {
      return {
        status: false,
        message: "Feedback not found",
      };
    }

    return {
      status: true,
      message: "Feedback retrieved successfully",
      data: feedback,
    };
  } catch (error) {
    console.error("❌ getFeedbackById Error:", error);
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.updateFeedbackStatus = async (feedbackId, newStatus = "resolved") => {
  try {
    const feedback = await Feedback.findByPk(feedbackId);

    if (!feedback) {
      return {
        status: false,
        message: "Feedback not found",
      };
    }

    feedback.status = newStatus;
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
