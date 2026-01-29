const {
  Notification,
  NotificationRead,
  Admin,
  AdminRole,
} = require("../../../models");
const { Op } = require("sequelize");

// ✅ Create a notification
exports.createNotification = async (title, description, category, adminId) => {
  try {
    const notification = await Notification.create({
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

// ✅ Mark all unread notifications (created by others) as read for this admin
exports.markAsRead = async (adminId) => {
  try {
    // Step 1: Get all notifications NOT created by this admin
    const allNotifications = await Notification.findAll({
      where: { adminId: { [Op.ne]: adminId } }, // 👈 exclude own-created
      attributes: ["id"],
    });

    if (!allNotifications.length) {
      return {
        status: true,
        data: { markedAsRead: 0, totalAvailable: 0 },
        message: "No notifications available from other users.",
      };
    }

    // Step 2: Get all already-read notification IDs for this admin
    const readNotifications = await NotificationRead.findAll({
      where: { adminId },
      attributes: ["notificationId"],
    });

    const readIds = readNotifications.map((r) => r.notificationId);

    // Step 3: Find unread notification IDs (from other users only)
    const unread = allNotifications.filter((n) => !readIds.includes(n.id));

    // Step 4: Prepare bulk insert for new read records
    const newReadEntries = unread.map((n) => ({
      adminId,
      notificationId: n.id,
    }));

    if (newReadEntries.length > 0) {
      await NotificationRead.bulkCreate(newReadEntries);
    }

    return {
      status: true,
      data: {
        markedAsRead: newReadEntries.length,
        totalAvailable: allNotifications.length,
      },
      message:
        newReadEntries.length > 0
          ? `${newReadEntries.length} new notification(s) from others marked as read.`
          : "All notifications from others were already marked as read.",
    };
  } catch (error) {
    return {
      status: false,
      message: `Failed to mark notifications as read. ${error.message}`,
    };
  }
};

exports.getAllNotifications = async (adminId, category = null, options = {}, data = {}) => {
  try {

    const {
      isSuperAdmin = false,
      superAdminId = null,
      adminIds = []
    } = data;

    // 🧩 Validate adminId
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    // 🧠 Fetch logged-in admin info
    const admin = await Admin.findByPk(Number(adminId), {
      attributes: ["id", "roleId", "firstName", "lastName", "email", "profile"],
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
        },
      ],
    });

    if (!admin) {
      return {
        status: false,
        message: "Admin not found.",
        data: [],
      };
    }

    // 🧮 Build filter condition
    const whereCondition = {};

    if (category) whereCondition.category = category;
    const userRole = admin.role?.role?.toLowerCase();

    if (isSuperAdmin) {
      whereCondition.adminId = { [Op.in]: adminIds };
    } else if (userRole === "parents") {
      // Parent: apni hi notifications
      whereCondition.adminId = adminId;
    } else if (!isSuperAdmin && superAdminId) {
      whereCondition.adminId = superAdminId;
    } else {
      return {
        status: false,
        message:
          "Invalid admin context: neither Super Admin nor linked Super Admin found.",
        data: [],
      };
    }

    // if (isSuperAdmin) {
    //   // ✅ Super Admin → include all admins under them
    //   whereCondition.adminId = { [Op.in]: adminIds };
    // } else if (!isSuperAdmin && superAdminId) {
    //   // ✅ Normal Admin → show only their Super Admin’s notifications
    //   whereCondition.adminId = superAdminId;
    // } else {
    //   // ⚠️ No valid admin context found
    //   return {
    //     status: false,
    //     message: "Invalid admin context: neither Super Admin nor linked Super Admin found.",
    //     data: [],
    //   };
    // }

    // 📦 Fetch notifications
    const notifications = await Notification.findAll({
      where: whereCondition,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "admin",
          attributes: ["id", "firstName", "lastName", "email", "profile"],
        },
      ],
    });

    // 🧾 Get IDs of fetched notifications
    const notificationIds = notifications.map((n) => n.id);

    // 🔖 Fetch read notifications for the admin
    const readRecords = await NotificationRead.findAll({
      where: {
        // adminId,
        notificationId: { [Op.in]: notificationIds }, // ✅ added condition
      },
      attributes: ["notificationId"],
      raw: true,
    });

    const readIds = new Set(readRecords.map((r) => r.notificationId));

    // 🧩 Format response
    const formattedNotifications = notifications.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description,
      category: n.category,
      createdAt: n.createdAt,
      isRead: readIds.has(n.id),
      admin: n.admin
        ? {
          id: n.admin.id,
          firstName: n.admin.firstName,
          lastName: n.admin.lastName,
          email: n.admin.email,
          profile: n.admin.profile,
        }
        : null,
    }));

    // ✅ Final structured response
    return {
      status: true,
      message: "Notifications fetched successfully.",
      data: {
        roleId: admin.roleId,
        role: admin.role?.role || null,
        admin: {
          id: admin.id,
          firstName: admin.firstName,
          lastName: admin.lastName,
          email: admin.email,
          profile: admin.profile,
        },
        notifications: formattedNotifications,
      },
    };
  } catch (error) {
    console.error("❌ Error in getAllNotifications:", error);
    return {
      status: false,
      message: "Failed to fetch notifications.",
      error: error.message,
    };
  }
};

// exports.getAllNotifications = async (
//   adminId,
//   category = null,
//   options = {}
// ) => {
//   try {
//     // 1️⃣ Fetch logged-in admin info (id, roleId, name, email, profile)
//     const admin = await Admin.findByPk(adminId, {
//       attributes: ["id", "roleId", "firstName", "lastName", "email", "profile"],
//       include: [
//         {
//           model: AdminRole, // join AdminRoles table
//           as: "role", // make sure association is defined as Admin.hasOne(AdminRoles, { as: 'role', foreignKey: 'id' })
//           attributes: ["id", "role"], // fetch role info
//         },
//       ],
//     });

//     if (!admin) {
//       return {
//         status: false,
//         message: "Admin not found.",
//       };
//     }
//     const whereCondition = {};

//     if (category) {
//       whereCondition.category = category;
//     }

//     // ✅ Exclude own-created notifications
//     if (options.excludeOwn) {
//       whereCondition.adminId = { [Op.ne]: adminId };
//     }

//     const notifications = await Notification.findAll({
//       where: whereCondition,
//       order: [["createdAt", "DESC"]],
//       include: [
//         {
//           model: Admin,
//           as: "admin",
//           attributes: ["id", "firstName", "lastName", "email", "profile"],
//         },
//       ],
//     });

//     const readRecords = await NotificationRead.findAll({
//       where: { adminId },
//       attributes: ["notificationId"],
//       raw: true,
//     });

//     const readIdsSet = new Set(readRecords.map((r) => r.notificationId));

//     const notificationList = notifications.map((n) => ({
//       id: n.id,
//       title: n.title,
//       description: n.description,
//       category: n.category,
//       createdAt: n.createdAt,
//       isRead: readIdsSet.has(n.id),
//       admin: n.admin
//         ? {
//             id: n.admin.id,
//             firstName: n.admin.firstName,
//             lastName: n.admin.lastName,
//             email: n.admin.email,
//             profile: n.admin.profile,
//           }
//         : null,
//     }));

//     // 5️⃣ Final response
//     return {
//       status: true,
//       message: "Notifications fetched successfully.",
//       data: {
//         roleId: admin.roleId,
//         role: admin.role ? admin.role.role : null,
//         admin: {
//           id: admin.id,
//           firstName: admin.firstName,
//           lastName: admin.lastName,
//           email: admin.email,
//           profile: admin.profile,
//         },
//         notifications: notificationList,
//       },
//     };
//   } catch (error) {
//     return {
//       status: false,
//       message: `Failed to retrieve notifications. ${error.message}`,
//     };
//   }
// };

// exports.getAllNotifications = async (
//   adminId,
//   category = null,
//   options = {}
// ) => {
//   try {
//     const whereCondition = {};

//     if (category) {
//       whereCondition.category = category;
//     }

//     // ✅ Exclude own-created notifications
//     if (options.excludeOwn) {
//       whereCondition.adminId = { [Op.ne]: adminId };
//     }

//     const notifications = await Notification.findAll({
//       where: whereCondition,
//       order: [["createdAt", "DESC"]],
//       include: [
//         {
//           model: Admin,
//           as: "admin",
//           attributes: ["id", "firstName", "lastName", "email", "profile"],
//         },
//       ],
//     });

//     const readRecords = await NotificationRead.findAll({
//       where: { adminId },
//       attributes: ["notificationId"],
//       raw: true,
//     });

//     const readIdsSet = new Set(readRecords.map((r) => r.notificationId));

//     const notificationList = notifications.map((n) => ({
//       id: n.id,
//       title: n.title,
//       description: n.description,
//       category: n.category,
//       createdAt: n.createdAt,
//       isRead: readIdsSet.has(n.id),
//       admin: n.admin
//         ? {
//             id: n.admin.id,
//             firstName: n.admin.firstName,
//             lastName: n.admin.lastName,
//             email: n.admin.email,
//             profile: n.admin.profile,
//           }
//         : null,
//     }));

//     return {
//       status: true,
//       data: notificationList,
//       message: `${notificationList.length} notification(s) retrieved successfully.`,
//     };
//   } catch (error) {
//     return {
//       status: false,
//       message: `Failed to retrieve notifications. ${error.message}`,
//     };
//   }
// };
