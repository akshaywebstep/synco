const FeedbackService = require("../../services/admin/feedbackService");
const { logActivity } = require("../../utils/admin/activityLogger");
const { validateFormData } = require("../../utils/validateFormData");
const { createNotification, createCustomNotificationForAdmins } = require("../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../utils/auth");
const { sequelize } = require("../../models");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "feedback";

exports.createFeedback = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      serviceType,
      bookingId,
      classScheduleId,
      oneToOneBookingId,
      birthdayPartyBookingId,
      holidayBookingId,
      holidayClassScheduleId,
      feedbackType,
      category,
      notes,
      agentAssigned,
      status,
    } = req.body;

    // Common validation
    const validation = validateFormData(req.body, [
      "serviceType",
      "feedbackType",
      "category",
    ]);

    if (!validation.isValid) {
      await transaction.rollback();
      return res.status(400).json(validation);
    }

    // Service-type specific validation
    switch (serviceType) {
      case "weekly class membership":
      case "weekly class trial":
        if (!bookingId || !classScheduleId) {
          throw new Error("bookingId and classScheduleId are required");
        }
        break;
      case "one to one":
        if (!oneToOneBookingId) {
          throw new Error("oneToOneBookingId is required");
        }
        break;
      case "birthday party":
        if (!birthdayPartyBookingId) {
          throw new Error("birthdayPartyBookingId is required");
        }
        break;
      case "holiday camp":
        if (!holidayBookingId || !holidayClassScheduleId) {
          throw new Error("holidayBookingId and holidayClassScheduleId are required");
        }
        break;
      default:
        throw new Error("Invalid serviceType");
    }

    // Determine creator info based on role
    let createdBy = null;
    let createdByParent = null;
    let role = null;

    if (req.parent) {
      createdBy = null;
      createdByParent = req.parent.id;
      role = "Parents";

    } else if (req.admin) {
      createdBy = req.admin.id;
      createdByParent = null;
      role = "Admin";
    }

    // Prepare feedback data for service
    const feedbackData = {
      serviceType,
      bookingId,
      classScheduleId,
      oneToOneBookingId,
      birthdayPartyBookingId,
      holidayBookingId,
      holidayClassScheduleId,
      feedbackType,
      category,
      notes: notes || null,
      agentAssigned: agentAssigned || null,
      status: status || "in_process",
      createdBy,
      createdByParent,
      role,
    };

    // Create feedback via service with transaction
    const result = await FeedbackService.createFeedbackById(feedbackData, transaction);

    if (!result.status) {
      await transaction.rollback();
      return res.status(400).json(result);
    }

    await transaction.commit();
    // ============================================================
    // 🔔 Custom Notification for Admins (Feedback Created)
    // ============================================================
    try {
      const creatorName = req.parent
        ? "Parent"
        : `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""}`.trim();

      await createCustomNotificationForAdmins({
        createdByAdminId: req.admin?.id || null, // null if parent created
        title: "New Feedback Created",
        description: `New feedback (${serviceType}) was created by ${creatorName}.`,
        category: "Support",
      });

      console.log("🔔 Admin notification sent for feedback creation");
    } catch (err) {
      console.error("❌ Admin feedback notification failed:", err.message);
    }

    // Send notification if agent assigned and created by admin
    if (agentAssigned && role === "admin") {
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
    const userId = req.admin?.id || req.parent?.id;
    const role = req.admin ? "Admin" : req.parent ? "Parents" : null;

    if (DEBUG) {
      console.log("🔍 User ID:", userId);
      console.log("🔍 User Role:", role);
    }

    if (!userId || !role) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized or invalid user",
      });
    }

    // Fetch super admin info only for admins and parents
    let superAdminId = null;
    if (role === "Admin" || role === "Parents") {
      const mainSuperAdminResult = await getMainSuperAdminOfAdmin(userId);
      superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

      if (DEBUG) {
        console.log("🔍 Main Super Admin Result:", mainSuperAdminResult);
        console.log("🔍 Super Admin ID:", superAdminId);
      }

      // If parent and no super admin found, fallback and log
      if (role === "Parents" && !superAdminId) {
        if (DEBUG) {
          console.warn(`⚠️ No super admin found for parent user ${userId}. Will fetch only parent's feedback.`);
        }
      }
    }

    const result = await FeedbackService.getAllFeedbacks(userId, role, superAdminId);

    if (DEBUG) {
      console.log("🔍 Feedback Service Result:", result);
    }

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

// exports.getAllFeedbacks = async (req, res) => {
//   try {
//     const createdBy = req.admin?.id;

//     const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
//     const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

//     const result = await FeedbackService.getAllFeedbacks(
//       superAdminId
//     );

//     if (!result.status) {
//       return res.status(400).json(result);
//     }

//     return res.status(200).json({
//       status: true,
//       message: "All feedbacks retrieved successfully",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ getAllFeedbacks Controller Error:", error);
//     return res.status(500).json({
//       status: false,
//       message: "Server error",
//     });
//   }
// };

// exports.getFeedbackById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const createdBy = req.admin?.id;

//     if (!adminId) {
//       return res.status(401).json({
//         status: false,
//         message: "Unauthorized",
//       });
//     }

//     const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
//     const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

//     const result = await FeedbackService.getFeedbackById(
//       id,
//       superAdminId
//     );

//     if (!result.status) {
//       return res.status(404).json(result);
//     }

//     return res.status(200).json({
//       status: true,
//       message: "Feedback retrieved successfully",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ getFeedbackById Controller Error:", error.message);
//     return res.status(500).json({
//       status: false,
//       message: "Server error",
//     });
//   }
// };

exports.getFeedbackById = async (req, res) => {
  try {
    const feedbackId = req.params.id;

    // Determine user info and role
    const userId = req.admin?.id || req.parent?.id;
    const role = req.admin ? "Admin" : req.parent ? "Parents" : null;

    if (!userId || !role) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized",
      });
    }

    // Fetch super admin only if role is Admin or Parents
    let superAdminId = null;
    if (role === "Admin" || role === "Parents") {
      const mainSuperAdminResult = await getMainSuperAdminOfAdmin(userId);
      superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
    }

    // Call service with userId, role, and superAdminId for proper access control
    const result = await FeedbackService.getFeedbackById(feedbackId, userId, role, superAdminId);

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
    // ============================================================
    // 🔔 Custom Notification for Admins (Feedback Resolved)
    // ============================================================
    try {
      const resolverName = `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""}`.trim();

      await createCustomNotificationForAdmins({
        createdByAdminId: req.admin?.id || null,
        title: "Feedback Resolved",
        description: `Feedback ID ${feedbackId} has been resolved by ${resolverName}.`,
        category: "Support",
      });

      console.log("🔔 Admin notification sent for feedback resolution");
    } catch (err) {
      console.error("❌ Admin notification for feedback resolution failed:", err.message);
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
