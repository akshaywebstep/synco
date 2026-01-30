const notificationModel = require("../../../services/admin/notification/notification");
const { getAdminRoleById } = require("../../../services/admin/adminRole");
const customNotificationModel = require("../../../services/admin/notification/customNotification");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const validCategories = [
  "All",
  "Complaints",
  "Payments",
  "Discounts",
  "Cancelled Memberships",
  "Admins",
  "Admin Roles",
  "System",
  "Activity Logs",
  "Security",
  "Login",
  "Settings",
  "Updates",
  "Announcements",
  "Tasks",
  "Messages",
  "Support",
];

const DEBUG = process.env.DEBUG === "true";

const PANEL = "admin";
const MODULE = "notification";

// exports.markNotificationAsRead = async (req, res) => {
//   const userId = req.admin?.id;
//   const roleName = req.admin?.role;
//   const category = req.body?.category || null;

//   console.log("req.admin:", req.admin);
//   console.log("Extracted userId:", userId);
//   console.log("Extracted roleName:", roleName);
//   console.log("Category for mark as read:", category);

//   if (!roleName || !userId) {
//     return res.status(400).json({
//       status: false,
//       message: "Invalid admin information.",
//     });
//   }

//   // Optional: Validate category against allowed list
//   if (category && !validCategories.includes(category)) {
//     return res.status(400).json({
//       status: false,
//       message: `Invalid category provided: ${category}`,
//     });
//   }

//   try {
//     let result;

//     if (category) {
//       result = await customNotificationModel.markAsRead(userId, category);
//     } else {
//       result = await notificationModel.markAsRead(userId);
//     }

//     if (!result.status) {
//       console.error(`❌ Failed to mark as read:`, result.message);
//       await logActivity(req, PANEL, MODULE, "markRead", result, false);
//       return res.status(500).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log(`✅ Marked as read:`, result.updatedCount);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "markRead",
//       { oneLineMessage: result.message },
//       true
//     );

//     return res.status(200).json({
//       status: true,
//       message: result.message,
//       data: result.updatedCount || 0,
//     });
//   } catch (error) {
//     console.error(`❌ Error marking as read:`, error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "markRead",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({
//       status: false,
//       message: "Server error while marking notifications as read.",
//     });
//   }
// };
exports.markNotificationAsRead = async (req, res) => {
  const userId = req.admin?.id;
  const roleName = req.admin?.role;
  const category = req.body?.category || null;

  console.log("req.admin:", req.admin);
  console.log("Extracted userId:", userId);
  console.log("Extracted roleName:", roleName);
  console.log("Category for mark as read:", category);

  if (!roleName || !userId) {
    return res.status(400).json({
      status: false,
      message: "Invalid admin information.",
    });
  }

  // Optional: Validate category against allowed list
  if (category && !validCategories.includes(category)) {
    return res.status(400).json({
      status: false,
      message: `Invalid category provided: ${category}`,
    });
  }

  try {
    let result;
    if (category === "All") {
      // ✅ Mark both custom and normal notifications as read
      const normalResult = await notificationModel.markAsRead(userId);
      const customResult = await customNotificationModel.markAsRead(userId);

      if (!normalResult.status || !customResult.status) {
        const errorMsg =
          normalResult.message ||
          customResult.message ||
          "Failed to mark all as read.";
        console.error(`❌ Failed to mark all as read:`, errorMsg);
        await logActivity(
          req,
          PANEL,
          MODULE,
          "markRead",
          { oneLineMessage: errorMsg },
          false
        );
        return res.status(500).json({ status: false, message: errorMsg });
      }

      result = {
        status: true,
        message: "All notifications marked as read successfully.",
        updatedCount:
          (normalResult.updatedCount || 0) + (customResult.updatedCount || 0),
      };
    } else if (category === "System") {
      // ✅ System notifications are in the normal model
      result = await notificationModel.markAsRead(userId);
    } else if (category) {
      // ✅ Custom notifications by category
      result = await customNotificationModel.markAsRead(userId, category);
    } else {
      // ✅ Default = normal notifications
      result = await notificationModel.markAsRead(userId);
    }

    if (!result.status) {
      console.error(`❌ Failed to mark as read:`, result.message);
      await logActivity(req, PANEL, MODULE, "markRead", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log(`✅ Marked as read:`, result.updatedCount);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "markRead",
      { oneLineMessage: result.message },
      true
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.updatedCount || 0,
    });
  } catch (error) {
    console.error(`❌ Error marking as read:`, error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "markRead",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Server error while marking notifications as read.",
    });
  }
};
// ✅ Get all notifications
exports.getAllNotifications = async (req, res) => {
  const adminId = req.admin?.id;
  const category = req.query?.category || null;

  if (DEBUG) {
    // console.log(`📨 Fetching notifications for Admin ID: ${superAdminId}`);
    console.log(`📂 Category filter: ${category}`);
    console.log(`🔐 Admin Role: ${req.admin?.role}`);
  }

  // ✅ Get Super Admin and related admins
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
  const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

  let adminIds = [];
  const isSuperAdmin = req.admin?.role?.toLowerCase() === "super admin";

  if (isSuperAdmin) {
    const admins = mainSuperAdminResult?.admins || [];
    adminIds = admins.length > 0 ? admins.map(a => a.id) : [];
  }

  try {
    // ✅ For normal notifications, still exclude own-created if required
    const notificationResult = await notificationModel.getAllNotifications(
      // superAdminId,
      adminId,
      category,
      { excludeOwn: true },
      {
        isSuperAdmin,
        superAdminId,
        adminIds
      }
    );

    // ✅ For custom notifications, DO NOT exclude own-created
    const customNotificationResult =
      await customNotificationModel.getAllReceivedCustomNotifications(
        superAdminId,
        // adminId,
        category
      );

    if (!notificationResult.status || !customNotificationResult.status) {
      const errorMsg =
        notificationResult.message ||
        customNotificationResult.message ||
        "Failed to fetch notifications.";

      console.error("❌ Notification fetch failed:", errorMsg);

      await logActivity(
        req,
        PANEL,
        MODULE,
        "list",
        { oneLineMessage: errorMsg },
        false
      );

      return res.status(500).json({ status: false, message: errorMsg });
    }

    const combinedData = {
      notifications: notificationResult.data || [],
      customNotifications: customNotificationResult.data || [],
    };

    const totalCount =
      (combinedData.notifications.length || 0) +
      (combinedData.customNotifications.length || 0);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Successfully fetched ${totalCount} notification(s).`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Notifications fetched successfully.",
      data: combinedData,
    });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error.message);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error while fetching notifications.",
    });
  }
};
// Get All Notifications for parent only
exports.getAllNotificationsForParent = async (req, res) => {
  const parentId = req.parent?.id;

  if (!parentId) {
    return res.status(403).json({
      status: false,
      message: "Unauthorized: Parent login required.",
    });
  }

  const category = req.query?.category || null;

  try {
    // Call notification service for parent only
    const notificationResult = await notificationModel.getAllNotificationsForParent(
      parentId,
      category,
      {}, // options if any
      { isParent: true } // flag to indicate parent-only logic
    );
    const customNotificationResult = await customNotificationModel.getAllReceivedCustomNotificationsForParent(
      parentId,
      category
    );
    if (!notificationResult.status || !customNotificationResult.status) {
      const errorMsg =
        notificationResult.message ||
        customNotificationResult.message ||
        "Failed to fetch notifications.";

      console.error("❌ Notification fetch failed:", errorMsg);

      await logActivity(
        req,
        PANEL,
        MODULE,
        "list",
        { oneLineMessage: errorMsg },
        false
      );

      return res.status(500).json({ status: false, message: errorMsg });
    }
     const combinedData = {
      notifications: notificationResult.data || [],
      customNotifications: customNotificationResult.data || [],
    };
    return res.status(200).json({
      status: true,
      message: "Notifications fetched successfully.",
      data: combinedData,
    });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching notifications.",
    });
  }
};

// ✅ Get all notifications
// exports.getAllNotifications = async (req, res) => {
//   const adminId = req.admin?.id || req.parent?.id;
//   const category = req.query?.category || null;

//   if (DEBUG) {
//     console.log(`📂 Category filter: ${category}`);
//     console.log(`🔐 Admin Role: ${req.admin?.role || req.parent?.role}`);
//   }

//   // ✅ Get Super Admin and related admins
//   const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
//   const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

//   let adminIds = [];
//   const isSuperAdmin = req.admin?.role?.toLowerCase() === "super admin";

//   if (isSuperAdmin) {
//     const admins = mainSuperAdminResult?.admins || [];
//     adminIds = admins.length > 0 ? admins.map(a => a.id) : [];
//   }

//   try {
//     // ✅ Normal notifications
//     const notificationResult = await notificationModel.getAllNotifications(
//       adminId,
//       category,
//       { excludeOwn: true },
//       {
//         isSuperAdmin,
//         superAdminId,
//         adminIds,
//       }
//     );

//     // ✅ Custom notifications
//     const customNotificationResult =
//       await customNotificationModel.getAllReceivedCustomNotifications(
//         superAdminId,
//         category
//       );

//     // ❌ Failure case
//     if (!notificationResult.status && !customNotificationResult.status) {
//       const errorMsg =
//         notificationResult.message ||
//         customNotificationResult.message ||
//         "Failed to fetch notifications.";

//       console.error("❌ Notification fetch failed:", errorMsg);

//       const logReq = {
//         ...req,
//         headers: req.headers,     // 🔥 keep headers
//         ip: req.ip,               // 🔥 keep ip
//         admin: req.admin || req.parent,
//       };

//       await logActivity(
//         logReq,
//         PANEL,
//         MODULE,
//         "list",
//         { oneLineMessage: errorMsg },
//         false
//       );

//       return res.status(500).json({
//         status: false,
//         message: errorMsg,
//       });
//     }

//     // ✅ Success case
//     const combinedData = {
//       notifications: notificationResult.data || [],
//       customNotifications: customNotificationResult.data || [],
//     };

//     const totalCount =
//       combinedData.notifications.length +
//       combinedData.customNotifications.length;

//     const logReq = {
//       ...req,
//       headers: req.headers,     // 🔥 keep headers
//       ip: req.ip,               // 🔥 keep ip
//       admin: req.admin || req.parent,
//     };

//     await logActivity(
//       logReq,
//       PANEL,
//       MODULE,
//       "list",
//       {
//         oneLineMessage: `Successfully fetched ${totalCount} notification(s).`,
//       },
//       true
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Notifications fetched successfully.",
//       data: combinedData,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching notifications:", error.message);

//     return res.status(500).json({
//       status: false,
//       message: "Server error while fetching notifications.",
//     });
//   }
// };
