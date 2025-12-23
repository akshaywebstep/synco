const FeedbackService = require("../../services/admin/feedbackService");
const { logActivity } = require("../../utils/admin/activityLogger");
const { validateFormData } = require("../../utils/validateFormData");
const { createNotification } = require("../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "feedback";

exports.createFeedback = async (req, res) => {
    const transaction = await require("../../models").sequelize.transaction();

    try {
        // 🔹 Step 1: Validate request body (NO venueId)
        const validation = validateFormData(req.body, [
            "bookingId",
            "title",
            "classScheduleId",
            "feedbackType",
            "category",
        ]);

        if (!validation.isValid) {
            await transaction.rollback();
            return res.status(400).json({
                status: false,
                message: validation.message,
            });
        }

        // 🔹 Step 2: Prepare feedback data
        const feedbackData = {
            ...req.body,
            createdBy: req.admin.id,
        };

        // 🔹 Step 3: Call service
        const result = await FeedbackService.createFeedbackById(
            feedbackData,
            transaction
        );

        if (!result.status) {
            await transaction.rollback();

            await logActivity(
                req,
                PANEL,
                MODULE,
                "create",
                { error: result.message },
                false
            );

            return res.status(400).json(result);
        }

        await transaction.commit();

        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { feedbackId: result.data.id },
            true
        );

        if (feedbackData.agentAssigned) {
            await createNotification(
                req,
                "New Feedback Assigned",
                "You have been assigned a new feedback.",
                "Support"
            );
        }

        return res.status(201).json({
            status: true,
            message: "Feedback created successfully",
            data: result.data,
        });

    } catch (error) {
        await transaction.rollback();
        console.error("❌ createFeedback Controller Error:", error);

        return res.status(500).json({
            status: false,
            message: "Internal server error",
        });
    }
};

exports.getAllFeedbacks = async (req, res) => {
  try {
    const result = await FeedbackService.getAllFeedbacks();

    console.log("🔹 Step 2: Service call completed");

    if (!result.status) {
      console.log("❌ Step 3: Service returned failure:", result.message);
      await logActivity(
        req,
        PANEL,
        "feedback",
        "read",
        { error: result.message },
        false
      );
      return res.status(400).json(result);
    }

    if (DEBUG) {
      console.log(
        "🔹 Step 4: DEBUG: Retrieved feedbacks:",
        JSON.stringify(result.data, null, 2)
      );
    }

    console.log(
      `🔹 Step 5: Logging success activity for ${result.data.length} feedback(s)`
    );
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read",
      { feedbackCount: result.data.length },
      true
    );

    console.log("✅ Step 6: Returning response to client");
    return res.status(200).json({
      status: true,
      message: "All feedbacks retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ listAllFeedbacks Controller Error:", error.message);
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getFeedbackById = async (req, res) => {
  try {
    const { id } = req.params; // ✅ feedbackId comes from route param
    console.log("🔹 Step 1: Calling service to get feedback by id...", { id });

    const result = await FeedbackService.getFeedbackById(id);

    console.log("🔹 Step 2: Service call completed");

    if (!result.status) {
      console.log("❌ Step 3: Service returned failure:", result.message);
      await logActivity(
        req,
        PANEL,
        "feedback",
        "read-single",
        { error: result.message, feedbackId: id },
        false
      );
      return res.status(404).json(result);
    }

    if (DEBUG) {
      console.log(
        "🔹 Step 4: DEBUG: Retrieved feedback:",
        JSON.stringify(result.data, null, 2)
      );
    }

    console.log("🔹 Step 5: Logging success activity for feedback", id);
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read-single",
      { feedbackId: id },
      true
    );

    console.log("✅ Step 6: Returning response to client");
    return res.status(200).json({
      status: true,
      message: "Feedback retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getFeedbackById Controller Error:", error.message);
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read-single",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.resolveFeedback = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { agentAssigned } = req.body; // 👈 optional

    const result = await FeedbackService.updateFeedbackStatus(
      feedbackId,
      "resolved",
      agentAssigned
    );

    if (!result.status) {
      return res.status(404).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ resolveFeedback Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};

// exports.getEventsByBookingId = async (req, res) => {
//   try {
//     const { bookingId } = req.params;

//     console.log(`📌 Controller: Fetching events for bookingId=${bookingId}`);

//     const result = await AccountInformationService.getEventsByBookingId(
//       bookingId
//     );

//     if (!result.status) {
//       return res.status(404).json({
//         status: false,
//         message: result.message,
//         data: result.data || [],
//       });
//     }

//     return res.status(200).json({
//       status: true,
//       message: result.message,
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ getEventsByBookingId Controller Error:", error.message);
//     return res.status(500).json({
//       status: false,
//       message: "Failed to fetch events",
//       error: error.message,
//     });
//   }
// };
