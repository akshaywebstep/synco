// src/controllers/admin/adminPermissionController.js

const adminPermissionModel = require("../../services/admin/adminPermission");
const { logActivity } = require("../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "admin-permission";

/**
 * ✅ List All Permissions
 */
exports.getAllAdminPermissions = async (req, res) => {
  try {
    const result = await adminPermissionModel.getAllPermissions();

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.table(result.data);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: `Fetched ${result.data.length} permissions.` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched permissions successfully.",
      data: result.data,
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
      message: "Failed to fetch permissions.",
    });
  }
};

/**
 * ✅ Get Permission by ID
 */
exports.getAdminPermissionById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await adminPermissionModel.getPermissionById(id);

    if (!result.status || !result.data) {
      const message = "Permission not found.";
      await logActivity(
        req,
        PANEL,
        MODULE,
        "getById",
        { oneLineMessage: message },
        false
      );
      return res.status(404).json({ status: false, message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { oneLineMessage: `Fetched permission ID ${id}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Permission fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Get Permission Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { oneLineMessage: error.message },
      false
    );
    return res
      .status(500)
      .json({ status: false, message: "Failed to fetch permission." });
  }
};

/**
 * ✅ Update Permission Status (true/false)
 */
exports.updateAdminPermissionStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // expecting boolean true/false

  if (typeof status !== "boolean") {
    const message = "Invalid status. Must be true or false.";
    await logActivity(
      req,
      PANEL,
      MODULE,
      "updateStatus",
      { oneLineMessage: message },
      false
    );
    return res.status(400).json({ status: false, message });
  }

  try {
    const existing = await adminPermissionModel.getPermissionById(id);

    if (!existing.status || !existing.data) {
      const message = "Permission not found.";
      await logActivity(
        req,
        PANEL,
        MODULE,
        "updateStatus",
        { oneLineMessage: message },
        false
      );
      return res.status(404).json({ status: false, message });
    }

    const update = await adminPermissionModel.updatePermissionStatus(
      id,
      status
    );

    if (!update.status) {
      await logActivity(req, PANEL, MODULE, "updateStatus", update, false);
      return res.status(500).json({ status: false, message: update.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "updateStatus",
      { oneLineMessage: `Updated permission ID ${id} status to ${status}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: `Permission status updated to ${status}.`,
    });
  } catch (error) {
    console.error("❌ Update Permission Status Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "updateStatus",
      { oneLineMessage: error.message },
      false
    );
    return res
      .status(500)
      .json({ status: false, message: "Failed to update permission status." });
  }
};
