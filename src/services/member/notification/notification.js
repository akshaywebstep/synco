const {
  CustomNotification,
  CustomNotificationRead,
  Admin,
} = require("../../../models");
const { Op } = require("sequelize");

// ✅ Get custom notifications for a member, with read status
exports.getAllNotifications = async (memberId) => {
  try {
    // Step 1: Fetch all read records for the member
    const readRecords = await CustomNotificationRead.findAll({
      where: { memberId },
      attributes: ["customNotificationId", "status"],
    });

    // Step 2: Map of notificationId → isRead status
    const readStatusMap = new Map();
    for (const record of readRecords) {
      if (!readStatusMap.has(record.customNotificationId)) {
        readStatusMap.set(record.customNotificationId, record.status === true);
      }
    }

    const notificationIds = Array.from(readStatusMap.keys());

    if (notificationIds.length === 0) {
      return {
        status: true,
        data: [],
        message: "No notifications found for this member.",
      };
    }

    // Step 3: Fetch notifications with admin info
    const notifications = await CustomNotification.findAll({
      where: { id: { [Op.in]: notificationIds } },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "admin",
          attributes: ["id", "name", "email"],
        },
      ],
    });

    // Step 4: Build response list
    const notificationList = notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      description: notification.description,
      category: notification.category,
      createdAt: notification.createdAt,
      isRead: readStatusMap.get(notification.id) || false,
      admin: notification.admin
        ? {
            id: notification.admin.id,
            name: notification.admin.name,
            email: notification.admin.email,
          }
        : null,
    }));

    return {
      status: true,
      message: `${notificationList.length} notification(s) retrieved successfully.`,
      data: notificationList,
    };
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    return {
      status: false,
      message: `Failed to retrieve notifications. ${error.message}`,
      data: [],
    };
  }
};

// ✅ Mark all unread custom notifications as read for the member
exports.markCustomNotificationAsRead = async (memberId) => {
  try {
    // Step 1: Update all unread (status = false) notifications for the member
    const [affectedRows] = await CustomNotificationRead.update(
      { status: true },
      {
        where: {
          memberId,
          status: false,
        },
      }
    );

    return {
      status: true,
      message: `${affectedRows} notification(s) marked as read.`,
    };
  } catch (error) {
    console.error("❌ Error marking notifications as read:", error);
    return {
      status: false,
      message: `Failed to mark notifications as read. ${error.message}`,
    };
  }
};
