const { sequelize } = require("../../config/db");
const {
  AdminRole,
  AdminRolePermission,
  AdminRoleHasPermission,
} = require("../../models");

// ✅ Create a role
exports.createAdminRole = async ({ role, permissions }) => {
  const transaction = await sequelize.transaction();
  try {
    // 1️⃣ Trim role name
    const roleName = role.trim();
    if (!roleName) {
      return { status: false, message: "Role name cannot be empty." };
    }

    // 2️⃣ Create role
    const newRole = await AdminRole.create({ role: roleName }, { transaction });

    // 3️⃣ Fetch only valid permissions
    const validPermissions = await AdminRolePermission.findAll({
      where: { id: permissions },
      transaction,
    });

    if (validPermissions.length > 0) {
      const rolePermissions = validPermissions.map((p) => ({
        roleId: newRole.id,
        permissionId: p.id,
      }));
      await AdminRoleHasPermission.bulkCreate(rolePermissions, { transaction });
    }

    await transaction.commit();

    return {
      status: true,
      message: `Role created successfully. ${
        validPermissions.length < permissions.length
          ? `Skipped ${
              permissions.length - validPermissions.length
            } invalid permission(s).`
          : "All permissions assigned."
      }`,
      data: newRole,
    };
  } catch (error) {
    await transaction.rollback();
    console.error("❌ Sequelize Error in createAdminRole:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Failed to create role.",
    };
  }
};

// ✅ Find role by name
exports.findAdminRoleByRole = async (role) => {
  try {
    const existingRole = await AdminRole.findOne({ where: { role } });

    if (!existingRole) {
      return {
        status: false,
        message: "Role not found.",
      };
    }
    console.log("existingRole", existingRole);
    return {
      status: true,
      message: "Role found.",
      data: existingRole,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in findRoleByRole:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Error finding role.",
    };
  }
};

// ✅ Get all roles
exports.getAllAdminRoles = async () => {
  try {
    const roles = await AdminRole.findAll({
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: AdminRolePermission,
          as: "permissions",
          through: { attributes: [] },
        },
      ],
    });

    const rolesWithPermissions = roles.map((role) => role.toJSON());

    return {
      status: true,
      message: `Fetched ${roles.length} role(s) successfully.`,
      data: rolesWithPermissions,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllRoles:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Failed to fetch roles.",
    };
  }
};

// ✅ Get role by ID
exports.getAdminRoleById = async (id) => {
  try {
    const role = await AdminRole.findByPk(id, {
      include: [
        {
          model: AdminRolePermission,
          as: "permissions",
          through: { attributes: [] },
        },
      ],
    });

    if (!role) {
      return {
        status: false,
        message: "Role not found.",
      };
    }

    return {
      status: true,
      message: "Role found.",
      data: role.toJSON(), // convert to JSON to include permissions array
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getRoleById:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Error retrieving role.",
    };
  }
};

// ✅ Update role
exports.updateAdminRole = async (id, updateData) => {
  const transaction = await sequelize.transaction();
  try {
    const { role, permissions } = updateData;

    // 1️⃣ Update role name if provided
    if (role) {
      const [updated] = await AdminRole.update(
        { role: role.trim() },
        { where: { id }, transaction }
      );

      if (updated === 0) {
        // No updates needed, rollback and return
        await transaction.rollback();
        return {
          status: false,
          message: "Role not found or no update applied.",
        };
      }
    }

    // 2️⃣ Handle permissions if provided
    if (Array.isArray(permissions)) {
      const existingPermissions = await AdminRoleHasPermission.findAll({
        where: { roleId: id },
        transaction,
      });

      const existingIds = existingPermissions.map((p) => p.permissionId);

      const validPermissions = await AdminRolePermission.findAll({
        where: { id: permissions },
        transaction,
      });
      const validIds = validPermissions.map((p) => p.id);

      const toAdd = validIds.filter((pid) => !existingIds.includes(pid));
      const toRemove = existingIds.filter((pid) => !validIds.includes(pid));

      if (toAdd.length > 0) {
        await AdminRoleHasPermission.bulkCreate(
          toAdd.map((pid) => ({ roleId: id, permissionId: pid })),
          { transaction }
        );
      }

      if (toRemove.length > 0) {
        await AdminRoleHasPermission.destroy({
          where: { roleId: id, permissionId: toRemove },
          transaction,
        });
      }
    }

    // ✅ Commit once at the end
    await transaction.commit();

    return {
      status: true,
      message: "Role updated successfully.",
    };
  } catch (error) {
    // Only rollback if transaction is still active
    if (!transaction.finished) {
      await transaction.rollback();
    }

    console.error("❌ Sequelize Error in updateAdminRole:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Failed to update role.",
    };
  }
};

exports.checkRolePermission = async (roleId, module, action) => {
  try {
    // 1️⃣ Check if role exists
    const role = await AdminRole.findByPk(roleId);
    if (!role) {
      return {
        status: false,
        message: `Role with ID ${roleId} does not exist.`,
        code: "ROLE_NOT_FOUND",
      };
    }

    // 2️⃣ Check if permission exists and is active
    const permission = await AdminRolePermission.findOne({
      where: {
        module: module.trim(),
        action: action.trim(),
        status: true, // only active permissions
      },
    });

    if (!permission) {
      return {
        status: false,
        message: `No active permission found for module "${module}" and action "${action}".`,
        code: "PERMISSION_NOT_FOUND",
      };
    }

    // 3️⃣ Check if the role has this permission
    const roleHasPermission = await AdminRoleHasPermission.findOne({
      where: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });

    if (!roleHasPermission) {
      return {
        status: false,
        message: `Role "${role.role}" does not have permission to perform "${action}" on module "${module}".`,
        code: "UNAUTHORIZED",
      };
    }

    // ✅ Role has the permission
    return {
      status: true,
      message: `Role "${role.role}" is authorized to perform "${action}" on module "${module}".`,
      data: {
        roleId: role.id,
        permissionId: permission.id,
        module: permission.module,
        action: permission.action,
      },
    };
  } catch (error) {
    console.error("❌ Sequelize Error in checkRolePermission:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to check role permission.",
      code: "ERROR_CHECKING_PERMISSION",
    };
  }
};

// ✅ Delete role
exports.deleteAdminRole = async (id) => {
  try {
    const deleted = await AdminRole.destroy({ where: { id } });

    if (deleted === 0) {
      return {
        status: false,
        message: "No role deleted. ID may be incorrect.",
      };
    }

    return {
      status: true,
      message: "Role deleted successfully.",
    };
  } catch (error) {
    console.error("❌ Sequelize Error in deleteRole:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage || error?.message || "Failed to delete role.",
    };
  }
};
