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
    const {
      serviceType,
      bookingId,
      classScheduleId,
      oneToOneBookingId,
      birthdayPartyBookingId,
      holidayBookingId,
      holidayClassScheduleId,
    } = req.body;

    // 🔹 Common validation
    const validation = validateFormData(req.body, [
      "serviceType",
      "feedbackType",
      "category",
    ]);

    if (!validation.isValid) {
      await transaction.rollback();
      return res.status(400).json(validation);
    }

    // 🔹 Service-type specific validation
    switch (serviceType) {
      case "weekly class membership":
      case "weekly class trial":
        if (!bookingId || !classScheduleId) {
          throw new Error("bookingId and classScheduleId are required");
        }
        break;

      case "one to one":
        if (!oneToOneBookingId) {  // classScheduleId no longer required here
          throw new Error("oneToOneBookingId is required");
        }
        break;

      case "birthday party":
        if (!birthdayPartyBookingId) {  // classScheduleId no longer required here
          throw new Error("birthdayPartyBookingId is required");
        }
        break;

      case "holiday camp":
        if (!holidayBookingId || !holidayClassScheduleId) {
          throw new Error(
            "holidayBookingId and holidayClassScheduleId are required"
          );
        }
        break;

      default:
        throw new Error("Invalid serviceType");
    }

    // 🔹 Prepare data
    const feedbackData = {
      ...req.body,
      createdBy: req.admin.id,
    };

    // 🔹 Create feedback
    const result = await FeedbackService.createFeedbackById(
      feedbackData,
      transaction
    );

    if (!result.status) {
      await transaction.rollback();
      return res.status(400).json(result);
    }

    await transaction.commit();

    // 🔹 Notification
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
    console.error("❌ createFeedback Error:", error.message);

    return res.status(400).json({
      status: false,
      message: error.message,
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
      return res.status(404).json(result);
    }

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

exports.getAgentsAndClasses = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching agents & class schedules...");

  try {
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    const result = await FeedbackService.getAgentsAndClasses(superAdminId);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message,
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.agents.length} agents & ${result.data.classSchedules.length} classes.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched agents and class schedules successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getAgentsAndClasses Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error.",
    });
  }
};

exports.getAgentsAndHolidayClasses = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching agents & class schedules...");

  try {
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    const result = await FeedbackService.getAgentsAndHolidayClasses(superAdminId);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message,
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.agents.length} agents & ${result.data.holidayClassSchedules.length} classes.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched agents and class schedules successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getAgentsAndHolidayClasses Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error.",
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
