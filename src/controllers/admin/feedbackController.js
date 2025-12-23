const FeedbackService = require("../../services/admin/feedbackService");
const { logActivity } = require("../../utils/admin/activityLogger");
const { validateFormData } = require("../../utils/validateFormData");
const { createNotification } = require("../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "feedback";

exports.createFeedback = async (req, res) => {
  const transaction = await require("../../models").sequelize.transaction();

  try {
    // 🔹 Step 1: Validate request body (NO venueId)
    const validation = validateFormData(req.body, [
      "bookingId",
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
    const adminId = req.admin?.id;

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId =
      mainSuperAdminResult?.superAdmin?.id ?? null;

    const result = await FeedbackService.getAllFeedbacks(
      adminId,
      superAdminId
    );

    if (!result.status) {
      return res.status(400).json(result);
    }

    return res.status(200).json({
      status: true,
      message: "All feedbacks retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getAllFeedbacks Controller Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};

exports.getFeedbackById = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id;

    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized",
      });
    }

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId =
      mainSuperAdminResult?.superAdmin?.id ?? null;

    const result = await FeedbackService.getFeedbackById(
      id,
      adminId,
      superAdminId
    );

    if (!result.status) {
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

    await logActivity(
      req,
      PANEL,
      "feedback",
      "read-single",
      { feedbackId: id },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Feedback retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getFeedbackById Controller Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
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

// ✅ Get all admins
exports.getAllAgent = async (req, res) => {
  if (DEBUG) console.log("📋 Request received to list all admins");
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  try {
    const result = await FeedbackService.getAllAgent(superAdminId);

    if (!result.status) {
      if (DEBUG) console.log("❌ Failed to retrieve agent:", result.message);

      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch agent.",
      });
    }

    if (DEBUG) {
      console.log(`✅ Retrieved ${result.data.length} admin(s)`);
      console.table(
        result.data.map((m) => ({
          ID: m.id,
          Name: m.name,
          Email: m.email,
          Created: m.createdAt,
        }))
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.length} agent(s) successfully.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: `Fetched ${result.data.length} agent(s) successfully.`,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ List Admins Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch agents. Please try again later.",
    });
  }
};

// ✅ GET All Class Schedules
exports.getAllClassSchedules = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all class schedules...");

  try {
    const adminId = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    const result = await FeedbackService.getAllClasses(superAdminId); // ✅ pass admin ID

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.table(result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: `Fetched ${result.data.length} class schedules.` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched class schedules successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching all class schedules:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
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
