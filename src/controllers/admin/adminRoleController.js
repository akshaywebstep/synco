const { validateFormData } = require("../../utils/validateFormData");
const adminRoleModel = require("../../services/admin/adminRole");

const { logActivity } = require("../../utils/admin/activityLogger");
const { createNotification } = require("../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "admin-role";

// ✅ Create Role
exports.createAdminRole = async (req, res) => {
  try {
    const { role, permissions } = req.body; // permissions = array of IDs

    if (DEBUG)
      console.log("📥 Received Role:", role, "Permissions:", permissions);

    // ✅ Validate role
    const validation = validateFormData({ role }, { requiredFields: ["role"] });

    if (!validation.isValid) {
      if (DEBUG) console.log("❌ Validation failed:", validation.error);
      await logActivity(req, PANEL, MODULE, "create", validation.error, false);
      return res.status(400).json({
        status: false,
        error: validation.error,
        message: validation.message,
      });
    }

    // ✅ Check if role already exists
    const { status: exists, data: existingRole } =
      await adminRoleModel.findAdminRoleByRole(role);
    if (exists && existingRole) {
      const message = "This role already exists. Please use a different role.";
      await logActivity(
        req,
        PANEL,
        MODULE,
        "create",
        { oneLineMessage: message },
        false
      );
      return res.status(409).json({ status: false, message });
    }

    // ✅ Create role and assign permissions (skipping invalid IDs)
    const createResult = await adminRoleModel.createAdminRole({
      role,
      permissions: Array.isArray(permissions) ? permissions : [],
    });

    if (!createResult.status) {
      await logActivity(req, PANEL, MODULE, "create", createResult, false);
      return res.status(500).json({
        status: false,
        message: createResult.message || "Failed to create role.",
      });
    }

    const successMessage = `New admin Role '${role}' created successfully by Admin: ${req.admin.name}`;
    if (DEBUG) console.log("✅", successMessage);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: `Role "${role}" created.` },
      true
    );
    await createNotification(
      req,
      "New Admin Role Added",
      successMessage,
      "Admin Roles"
    );

    return res.status(201).json({
      status: true,
      message: createResult.message || "Role created successfully.",
      data: createResult.data,
    });
  } catch (error) {
    console.error("❌ Create Role Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: error.message },
      false
    );
    return res
      .status(500)
      .json({ status: false, message: "Server error while creating role." });
  }
};

// ✅ List All Roles
exports.getAllAdminRoles = async (req, res) => {
  try {
    const result = await adminRoleModel.getAllAdminRoles();

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
      {
        oneLineMessage: `Fetched ${result.data.length} roles.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched roles successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ List Roles Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: error.message },
      false
    );
    return res
      .status(500)
      .json({ status: false, message: "Failed to fetch roles." });
  }
};

// ✅ Get Role by ID
exports.getAdminRoleById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await adminRoleModel.getAdminRoleById(id);

    if (!result.status || !result.data) {
      const message = "Role not found.";
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
      {
        oneLineMessage: `Fetched role ID ${id}`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Role fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Get Role Error:", error);
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
      .json({ status: false, message: "Failed to fetch role." });
  }
};

// ✅ Update Role
exports.updateAdminRole = async (req, res) => {
  const { id } = req.params;
  const { role, permissions } = req.body; // permissions = array of IDs

  if (!role) {
    const message = "Role is required.";
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

  try {
    // ✅ Fetch existing role
    const existing = await adminRoleModel.getAdminRoleById(id);
    if (!existing.status || !existing.data) {
      const message = "Role not found.";
      await logActivity(
        req,
        PANEL,
        MODULE,
        "update",
        { oneLineMessage: message },
        false
      );
      return res.status(404).json({ status: false, message });
    }

    // ✅ Check for duplicate role name
    const exists = await adminRoleModel.findAdminRoleByRole(role);
    console.log(`exists.data - `, exists.data);
    if (exists.status && exists.data && exists.data.id != id) {
      const message = "Role already exists.";
      await logActivity(
        req,
        PANEL,
        MODULE,
        "update",
        { oneLineMessage: message },
        false
      );
      return res.status(409).json({ status: false, message });
    }

    // ✅ Update role name
    const updateResult = await adminRoleModel.updateAdminRole(id, {
      role,
      permissions: Array.isArray(permissions) ? permissions : [],
    });

    if (!updateResult.status) {
      await logActivity(req, PANEL, MODULE, "update", updateResult, false);
      return res
        .status(500)
        .json({ status: false, message: updateResult.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      {
        oneLineMessage: `Updated role ID ${id} to "${role}"`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Role updated successfully.",
      data: updateResult.data, // includes updated permissions
    });
  } catch (error) {
    console.error("❌ Update Role Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: error.message },
      false
    );
    return res
      .status(500)
      .json({ status: false, message: "Failed to update role." });
  }
};

// ✅ Delete Role
exports.deleteAdminRole = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await adminRoleModel.getAdminRoleById(id);
    if (!result.status || !result.data) {
      const message = "Role not found.";
      await logActivity(
        req,
        PANEL,
        MODULE,
        "delete",
        { oneLineMessage: message },
        false
      );
      return res.status(404).json({ status: false, message });
    }

    const deleteResult = await adminRoleModel.deleteAdminRole(id);

    if (!deleteResult.status) {
      await logActivity(req, PANEL, MODULE, "delete", deleteResult, false);
      return res
        .status(500)
        .json({ status: false, message: deleteResult.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      {
        oneLineMessage: `Deleted role ID ${id}`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Role deleted successfully.",
    });
  } catch (error) {
    if (DEBUG) error("❌ Delete Role Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: error.message },
      false
    );
    return res
      .status(500)
      .json({ status: false, message: "Failed to delete role." });
  }
};
