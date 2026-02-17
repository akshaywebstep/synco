const notificationService = require("../../services/admin/notification/notification");
const customNotificationModel = require("../../services/admin/notification/customNotification");
const DEBUG = process.env.DEBUG === "true";

/**
 * Logs a notification for admin panel actions.
 *
 * @param {Object} req - Express request object containing the admin session
 * @param {string} title - Notification title
 * @param {string} description - Detailed description for the notification
 * @param {string} category - One of the valid categories (e.g., "Complaints", "Payments", "Cancelled Memberships")
 * @param {string} [scope='global'] - Notification scope (default is 'global')
 *
 * @returns {Object} Response object with status, message, and optional data
 */
exports.createNotification = async (
  req,
  title,
  description,
  category,
  scope = "global"
) => {
  if (scope !== "global") {
    console.warn(
      `⚠️ Skipping notification log due to non-global scope: ${scope}`
    );
    return {
      status: true,
      message: "Scope not applicable for global notifications.",
    };
  }

  if (DEBUG) {
    console.log(
      `🟢 [createNotification] Initiated by Admin: ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }`
    );
    console.log(`📩 Details →`, { title, description, category, scope });
  }

  if (!category) {
    const message = "Notification category is required.";
    console.warn(`⚠️ ${message}`);
    return { status: false, message };
  }

  const validCategories = [
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

  if (!validCategories.includes(category)) {
    const message = `Invalid category. Allowed categories: ${validCategories.join(
      ", "
    )}`;
    console.warn(`🚫 ${message}`);
    return { status: false, message };
  }

  try {
    const result = await notificationService.createNotification(
      title || null,
      description || null,
      category,
      // req?.admin?.id
      req?.admin?.id || req?.notificationAdminId
    );

    if (!result.status) {
      console.error(`❌ Notification creation failed:`, result.message);
      return { status: false, message: result.message };
    }

    if (DEBUG) {
      console.log(`✅ Notification created successfully.`);
      console.log(`📦 Result:`, result.data);
    }

    return {
      status: true,
      message: result.message,
      data: result.data,
    };
  } catch (error) {
    const errorMessage =
      error?.message || "Unhandled error while creating notification.";
    console.error(`❌ [Exception] Notification creation error:`, errorMessage);
    return {
      status: false,
      message: "Server error occurred while logging notification.",
    };
  }
};

/**
 * Create custom notification for multiple admins (parents)
 */
exports.createCustomNotificationForAdmins = async ({
  title = null,
  description = null,
  category,
  createdByAdminId,
  recipientAdminIds = [],
}) => {
  try {
    // 1️⃣ Create notification
    const result = await customNotificationModel.createCustomNotification(
      title,
      description,
      category,
      createdByAdminId
    );

    if (!result.status) {
      return result;
    }

    const notificationId = result.data.id;

    // 2️⃣ Remove duplicates + creator
    const uniqueAdminIds = [
      ...new Set(
        recipientAdminIds
          .map((id) => Number(id))
          .filter((id) => id && id !== createdByAdminId)
      ),
    ];

    // 3️⃣ Create read entries
    await Promise.all(
      uniqueAdminIds.map((adminId) =>
        customNotificationModel.createCustomNotificationReads({
          customNotificationId: notificationId,
          adminId,
        })
      )
    );

    return {
      status: true,
      message: "Custom notification sent successfully.",
      data: { id: notificationId },
    };
  } catch (error) {
    console.error("❌ Helper error:", error);
    return {
      status: false,
      message: "Failed to send custom notification.",
    };
  }
};
