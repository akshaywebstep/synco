const {
  CustomNotification,
  CustomNotificationRead,
  Admin,
  AdminRole,
} = require("../../../models");
const { Op } = require("sequelize");

exports.markAsRead = async (adminId, category) => {
  try {
    const whereCondition = { adminId };
    if (category) {
      whereCondition["$notification.category$"] = category; // ✅ match alias
    }

    const reads = await CustomNotificationRead.findAll({
      where: whereCondition,
      include: [
        {
          model: CustomNotification,
          as: "notification", // ✅ match alias from your model
          attributes: ["id", "category"],
        },
      ],
    });

    const customNotificationIds = reads.map((r) => r.customNotificationId);

    if (!customNotificationIds.length) {
      return {
        status: true,
        message: "No notifications found for this user.",
        updatedCount: 0,
      };
    }

    const [updatedCount] = await CustomNotificationRead.update(
      {
        status: true,
        updatedAt: new Date(),
      },
      {
        where: {
          adminId,
          status: false,
          customNotificationId: customNotificationIds,
        },
      }
    );

    return {
      status: true,
      message: `Marked as read (${category || "all"}).`,
      updatedCount,
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      status: false,
      message: `Error marking notifications as read: ${err.message}`,
    };
  }
};

// ✅ Create a notification
exports.createCustomNotification = async (
  title,
  description,
  category,
  adminId
) => {
  try {
    const notification = await CustomNotification.create({
      title: title || null,
      description: description || null,
      category,
      adminId,
      createdAt: new Date(),
    });

    return {
      status: true,
      data: {
        id: notification.id,
      },
      message: "Notification created successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Failed to create notification. ${error.message}`,
    };
  }
};

// ✅ Create a read record for a custom notification
exports.createCustomNotificationReads = async ({
  customNotificationId,
  adminId,
  status = false,
}) => {
  try {
    console.log(`{ customNotificationId, adminId, status = false } - `, {
      customNotificationId,
      adminId,
      status,
    });
    const readRecord = await CustomNotificationRead.create({
      customNotificationId,
      adminId,
      status,
      createdAt: new Date(),
    });

    return {
      status: true,
      data: {
        id: readRecord.id,
      },
      message: "Notification read record created successfully.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Failed to create notification read record. ${error.message}`,
    };
  }
};

// exports.getAllCustomNotifications = async (adminId, category = null) => {
//   try {
//     const whereCondition = {};
//     if (category) {
//       whereCondition.category = category;
//     }

//     const notifications = await CustomNotification.findAll({
//       where: whereCondition,
//       order: [["createdAt", "DESC"]],
//       include: [
//         {
//           model: Admin,
//           as: "admin", // Creator of the notification
//           attributes: ["id", "firstName", "lastName", "email"],
//         },
//         {
//           model: CustomNotificationRead,
//           as: "reads", // Reading logs
//           include: [
//             {
//               model: Admin,
//               as: "admin", // 🔧 FIXED: This must match the alias defined in CustomNotificationRead
//               attributes: ["id", "email", "firstName", "lastName"],
//             },
//           ],
//         },
//       ],
//     });

//     const formattedNotifications = notifications.map((n) => {
//       const notif = n.toJSON();

//       return {
//         id: notif.id,
//         title: notif.title,
//         description: notif.description,
//         category: notif.category,
//         createdAt: notif.createdAt,
//         createdBy: {
//           id: notif.admin?.id,
//           email: notif.admin?.email,
//           name: `${notif.admin?.firstName || ""} ${
//             notif.admin?.lastName || ""
//           }`.trim(),
//         },
//         recipients: notif.reads.map((read) => ({
//           recipientId: read.admin?.id,
//           recipientEmail: read.admin?.email,
//           isRead: read.status === true,
//         })),
//       };
//     });

//     return {
//       status: true,
//       data: formattedNotifications,
//       message: `${formattedNotifications.length} custom notification(s) retrieved successfully.`,
//     };
//   } catch (error) {
//     console.error("❌ Sequelize Error in getAllCustomNotifications:", error);

//     return {
//       status: false,
//       message: `Failed to retrieve custom notifications. ${error.message}`,
//     };
//   }
// };

exports.getAllCustomNotifications = async (adminId, category = null) => {
  try {
    // 🧩 Validate adminId
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const whereCondition = {};
    if (category) {
      whereCondition.category = category;
    }

    // Fetch only where the logged-in admin is the sender OR a recipient
    const notifications = await CustomNotification.findAll({
      where: {
        ...whereCondition,
        [Op.or]: [
          { adminId: adminId }, // sender
          { "$reads.adminId$": adminId }, // recipient
        ],
      },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "admin", // sender
          attributes: ["id", "firstName", "lastName", "email", "profile"],
        },
        {
          model: CustomNotificationRead,
          as: "reads", // recipients
          include: [
            {
              model: Admin,
              as: "admin",
              attributes: ["id", "email", "firstName", "lastName", "profile"],
            },
          ],
        },
      ],
    });

    // Format data
    const formattedNotifications = notifications.map((n) => {
      const notif = n.toJSON();

      return {
        id: notif.id,
        title: notif.title,
        description: notif.description,
        category: notif.category,
        createdAt: notif.createdAt,
        createdBy: {
          id: notif.admin?.id,
          email: notif.admin?.email,
          profile: notif.admin?.profile,
          name: `${notif.admin?.firstName || ""} ${notif.admin?.lastName || ""
            }`.trim(),
        },
        recipients: notif.reads.map((read) => ({
          recipientId: read.admin?.id,
          recipientEmail: read.admin?.email,
          recipientName: `${read.admin?.firstName || ""} ${read.admin?.lastName || ""
            }`.trim(),
          isRead: read.status === true,
        })),
      };
    });

    return {
      status: true,
      data: formattedNotifications,
      message: `${formattedNotifications.length} custom notification(s) retrieved successfully.`,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllCustomNotifications:", error);
    return {
      status: false,
      message: `Failed to retrieve custom notifications. ${error.message}`,
    };
  }
};

exports.getAllReceivedCustomNotifications = async (
  adminId,
  category = null
) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const whereCondition = {};

    if (category) {
      whereCondition.category = category;
    }

    const notifications = await CustomNotification.findAll({
      where: {
        ...whereCondition,
        [Op.and]: [
          { adminId: { [Op.ne]: adminId } }, // exclude sender's own created notifications
          {
            [Op.or]: [
              { "$reads.adminId$": adminId }, // only those where admin is recipient
            ],
          },
        ],
      },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "admin",
          attributes: ["id", "firstName", "lastName", "email", "profile"],
        },
        {
          model: CustomNotificationRead,
          as: "reads",
          include: [
            {
              model: Admin,
              as: "admin",
              attributes: ["id", "email", "firstName", "lastName", "profile"],
            },
          ],
        },
      ],
    });

    // Format data
    const formattedNotifications = notifications.map((n) => {
      const notif = n.toJSON();

      return {
        id: notif.id,
        title: notif.title,
        description: notif.description,
        category: notif.category,
        createdAt: notif.createdAt,
        createdBy: {
          id: notif.admin?.id,
          email: notif.admin?.email,
          profile: notif.admin?.profile,
          name: `${notif.admin?.firstName || ""} ${notif.admin?.lastName || ""
            }`.trim(),
        },
        recipients: notif.reads.map((read) => ({
          recipientId: read.admin?.id,
          recipientEmail: read.admin?.email,
          recipientName: `${read.admin?.firstName || ""} ${read.admin?.lastName || ""
            }`.trim(),
          isRead: read.status === true,
        })),
      };
    });

    return {
      status: true,
      data: formattedNotifications,
      message: `${formattedNotifications.length} custom notification(s) retrieved successfully.`,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllCustomNotifications:", error);
    return {
      status: false,
      message: `Failed to retrieve custom notifications. ${error.message}`,
    };
  }
};

exports.getAllReceivedCustomNotificationsForParent = async (parentId, category = null) => {
  try {
    if (!parentId || isNaN(Number(parentId))) {
      return {
        status: false,
        message: "No valid parent found for this request.",
        data: [],
      };
    }

    const whereCondition = {};
    if (category) {
      whereCondition.category = category;
    }

    const notifications = await CustomNotification.findAll({
      where: {
        ...whereCondition,
        adminId: { [Op.ne]: parentId },
      },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "admin",
          attributes: ["id", "firstName", "lastName", "email", "profile"],
        },
        {
          model: CustomNotificationRead,
          as: "reads",
          required: true,
          where: { adminId: parentId },
          include: [
            {
              model: Admin,
              as: "admin",
              attributes: ["id", "email", "firstName", "lastName", "profile"],
            },
          ],
        },
      ],
    });

    // Format response
    const formattedNotifications = notifications.map((n) => {
      const notif = n.toJSON();

      return {
        id: notif.id,
        title: notif.title,
        description: notif.description,
        category: notif.category,
        createdAt: notif.createdAt,
        createdBy: {
          id: notif.admin?.id,
          email: notif.admin?.email,
          profile: notif.admin?.profile,
          name: `${notif.admin?.firstName || ""} ${notif.admin?.lastName || ""}`.trim(),
        },
        recipients: notif.reads.map((read) => ({
          recipientId: read.admin?.id,
          recipientEmail: read.admin?.email,
          recipientName: `${read.admin?.firstName || ""} ${read.admin?.lastName || ""}`.trim(),
          isRead: read.status === true,
        })),
      };
    });

    return {
      status: true,
      data: formattedNotifications,
      message: `${formattedNotifications.length} custom notification(s) retrieved successfully.`,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllReceivedCustomNotifications:", error);
    return {
      status: false,
      message: `Failed to retrieve custom notifications. ${error.message}`,
      data: [],
    };
  }
};

// Get all admins login user
exports.getAllAdmins = async (loggedInAdminId) => {
  try {
    const admins = await Admin.findAll({
      where: {
        id: {
          [Op.ne]: loggedInAdminId, // Exclude current admin
        },
      },
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} admin(s) successfully.`,
      data: admins,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllAdmins:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch admins.",
    };
  }
};
