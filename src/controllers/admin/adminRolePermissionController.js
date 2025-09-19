// src/controllers/admin/adminPermissionController.js

const adminPermissionModel = require("../../services/admin/adminPermission");
const adminRoleModel = require("../../services/admin/adminRole");
const { logActivity } = require("../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "admin-permission";

/**
 * ✅ List All Permissions
 */
exports.getAllAdminRolePermissions = async (req, res) => {
  try {
    const roleResult = await adminRoleModel.getAllAdminRoles();
    const permissionResult = await adminPermissionModel.getAllPermissions();

    if (!roleResult.status) {
      await logActivity(req, PANEL, MODULE, "list", roleResult, false);
      return res
        .status(500)
        .json({ status: false, message: roleResult.message });
    }

    if (!permissionResult.status) {
      await logActivity(req, PANEL, MODULE, "list", permissionResult, false);
      return res
        .status(500)
        .json({ status: false, message: permissionResult.message });
    }

    if (DEBUG) {
      console.table(roleResult.data);
      console.table(permissionResult.data);
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${roleResult.data.length} roles and ${permissionResult.data.length} permissions.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched roles and permissions successfully.",
      meta: {
        totalRoles: roleResult.data.length,
        totalPermissions: permissionResult.data.length,
        timestamp: new Date().toISOString(),
      },
      data: {
        roles: roleResult.data,
        permissions: permissionResult.data,
      },
    });
  } catch (error) {
    console.error("❌ List Permissions Error:", error);

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
      message: "Failed to fetch roles and permissions.",
    });
  }
};

/**
 * ✅ Update Permission Status (true/false)
 */
exports.updateAdminRolePermissions = async (req, res) => {
  const updates = req.body; // expecting an array

  if (!Array.isArray(updates) || updates.length === 0) {
    const message = "At least one role update is required.";
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: message },
      false
    );
    return res.status(400).json({ status: false, message });
  }

  const results = [];

  try {
    for (const update of updates) {
      const { roleId, permissions } = update;

      // ✅ Fetch existing role
      const existing = await adminRoleModel.getAdminRoleById(roleId);
      if (!existing.status || !existing.data) {
        results.push({
          roleId,
          status: false,
          message: "Role not found.",
        });
        continue;
      }

      // ✅ Update role (permissions only here, no role name change in bulk mode)
      const updateResult = await adminRoleModel.updateAdminRole(roleId, {
        permissions: Array.isArray(permissions) ? permissions : [],
      });

      if (!updateResult.status) {
        results.push({
          roleId,
          status: false,
          message: updateResult.message,
        });
        continue;
      }

      await logActivity(
        req,
        PANEL,
        MODULE,
        "update",
        {
          oneLineMessage: `Updated role ID ${roleId} with ${permissions.length} permissions.`,
        },
        true
      );

      results.push({
        roleId,
        status: true,
        message: "Role updated successfully.",
        data: updateResult.data,
      });
    }

    return res.status(200).json({
      status: true,
      message: "Bulk role update process completed.",
      summary: {
        total: updates.length,
        success: results.filter((r) => r.status).length,
        failed: results.filter((r) => !r.status).length,
      },
      results,
    });
  } catch (error) {
    console.error("❌ Bulk Update Role Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Failed to process bulk role updates.",
    });
  }
};
