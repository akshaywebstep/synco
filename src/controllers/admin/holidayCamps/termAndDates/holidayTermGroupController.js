const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const TermGroupService = require("../../../../services/admin/holidayCamps/termAndDates/holidayTermGroup");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "holiday-term-group";

// ----------------------------------------
// ✅ TERM GROUP CONTROLLERS
// ----------------------------------------

// ✅ CREATE
exports.createHoliayTermGroup = async (req, res) => {
  const { name } = req.body;
  const adminId = req.admin?.id;

  const validation = validateFormData(req.body, {
    requiredFields: ["name"],
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  try {
    const result = await TermGroupService.createHolidayGroup({
      name,
      createdBy: adminId,
    });
    await logActivity(req, PANEL, MODULE, "create", result, result.status);
    // ✅ Notification
    // await createNotification(
    //   req,
    //   "Term Group Created",
    //   `Term Group '${name}' was created by ${req?.admin?.firstName || "Admin"
    //   }.`,
    //   "System"
    // );
    return res.status(result.status ? 201 : 500).json(result);
  } catch (error) {
    console.error("❌ Error in createTermGroup:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ LIST ALL - with adminId
exports.getAllHolidayGroups = async (req, res) => {
  const adminId = req.admin?.id;

  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await TermGroupService.getAllHolidayGroups(superAdminId); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "list", result, result.status);
    return res.status(result.status ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ Error in getAllGroups:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ GET BY ID - with adminId
exports.getHolidayGroupById = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  if (!id) {
    return res.status(400).json({ status: false, message: "ID is required." });
  }

  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await TermGroupService.getHolidayGroupById(id, superAdminId); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "getById", result, result.status);
    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in getGroupById:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ UPDATE Term Group
exports.updateHolidayGroup = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;
  const { name } = req.body;

  const validation = validateFormData(req.body, {
    requiredFields: ["name"],
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "update", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  try {
    const result = await TermGroupService.updateHolidayGroup(id, { name }, adminId);
    await logActivity(req, PANEL, MODULE, "update", result, result.status);

    await createNotification(
      req,
      "Term Group Updated",
      `Term Group '${name}' was updated by ${req?.admin?.firstName || "Admin"
      }.`,
      "System"
    );

    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in updateGroup:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ DELETE Term Group

exports.deleteHolidayGroup = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // ✅ track who deletes

  if (!id) {
    return res.status(400).json({ status: false, message: "ID is required." });
  }

  try {
    // ✅ Soft delete group
    const result = await TermGroupService.deleteHolidayGroup(id, adminId);

    // ✅ Log activity
    await logActivity(req, PANEL, MODULE, "delete", result, result.status);

    // ✅ Send notification if successful
    if (result.status) {
      await createNotification(
        req,
        "Term Group Deleted",
        `Term Group ID '${id}' and its associated terms were deleted by ${req?.admin?.firstName || "Admin"
        }.`,
        "System"
      );
    }

    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in deleteGroup Controller:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "delete",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};
