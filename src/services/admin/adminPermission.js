// src/services/admin/AdminRolePermission.js
const { AdminRolePermission } = require("../../models");

// ✅ Get all permissions
exports.getAllPermissions = async () => {
  try {
    const permissions = await AdminRolePermission.findAll({
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${permissions.length} permission(s) successfully.`,
      data: permissions,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllPermissions:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch permissions.",
    };
  }
};

// ✅ Get permission by ID
exports.getPermissionById = async (id) => {
  try {
    const permission = await AdminRolePermission.findByPk(id);

    if (!permission) {
      return {
        status: false,
        message: "Permission not found.",
      };
    }

    return {
      status: true,
      message: "Permission found.",
      data: permission,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getPermissionById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error retrieving permission.",
    };
  }
};

// ✅ Update permission status (true/false)
exports.updatePermissionStatus = async (id, status) => {
  try {
    const [updated] = await AdminRolePermission.update(
      { status },
      { where: { id } }
    );

    if (updated === 0) {
      return {
        status: false,
        message: "No permission updated. ID may be incorrect.",
      };
    }

    return {
      status: true,
      message: `Permission status updated to ${status}.`,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in updatePermissionStatus:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to update permission status.",
    };
  }
};
