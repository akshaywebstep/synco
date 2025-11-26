const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const HolidayCampDateService = require("../../../../services/admin/holidayCamps/campAndDates/holidayCampDates");
const { HolidayCamp, HolidayCampDates } = require("../../../../models"); // ✅ Required models
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "camp-date";

// ✅ CREATE TERM
exports.createHolidayCampDates = async (req, res) => {
  const adminId = req.admin?.id;
  const {
    holidayCampId,
    startDate,
    endDate,
    totalDays,
    sessionsMap = [],
  } = req.body;

  const validation = validateFormData(req.body, {
    requiredFields: [
      "holidayCampId",
      "startDate",
      "endDate",
      "totalDays",
      "sessionsMap",
    ],
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  if (!Array.isArray(sessionsMap) || sessionsMap.length === 0) {
    return res.status(400).json({
      status: false,
      message: "Please provide at least one sessionDate and sessionPlanId.",
    });
  }

  try {
    const result = await HolidayCampDateService.createHolidayCampDates({
      holidayCampId,
      startDate,
      endDate,
      totalDays,
      sessionsMap,
      createdBy: adminId,
    });

    if (!result.status) {
      return res.status(400).json(result);
    }

    await logActivity(req, PANEL, MODULE, "create", { message: "Camp created" }, true);

    await createNotification(
      req,
      "Camp Created",
      `Camp Date was created by ${req.admin?.firstName || "Admin"}.`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Camp created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error in createHolidayCampDates controller:", error);

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

// ✅ GET ALL Camp (admin-specific)
exports.getAllHolidayCampDates = async (req, res) => {
  const adminId = req.admin?.id;
  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await HolidayCampDateService.getAllHolidayCampDates(superAdminId);
    await logActivity(req, PANEL, MODULE, "list", result, result.status);
    return res.status(result.status ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ getAllCampDates error:", error);
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

// ✅ GET Camp BY ID (admin-specific)
exports.getHolidayCampDatesById = async (req, res) => {
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
    const result = await HolidayCampDateService.getHolidayCampDatesById(id, superAdminId);
    await logActivity(req, PANEL, MODULE, "getById", result, result.status);
    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ getTermById error:", error);
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

// ✅ UPDATE TERM
exports.updateHolidayCampDates = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  const {
    holidayCampId,
    startDate,
    endDate,
    totalDays,
    sessionsMap = [],
  } = req.body;

  if (DEBUG) {
    console.log("🛠 Updating Camp ID:", id);
    console.log("📥 Received Update FormData:", req.body);
  }

  if (!id) {
    await logActivity(req, PANEL, MODULE, "update", "ID is required", false);
    return res.status(400).json({ status: false, message: "ID is required." });
  }

  // ✅ Validate required fields
  const validation = validateFormData(req.body, {
    requiredFields: ["holidayCampId", "startDate", "endDate"],
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "update", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  // ✅ Must have at least one session if sessionsMap provided
  if (Array.isArray(sessionsMap) && sessionsMap.length === 0) {
    return res.status(400).json({
      status: false,
      message: "Please provide at least one sessionDate and sessionPlanId.",
    });
  }

  try {
    const updatePayload = {
      holidayCampId,
      startDate,
      endDate,
      totalDays,
      sessionsMap,
    };

    const result = await HolidayCampDateService.updateHolidayCampDates(id, updatePayload, adminId); // ✅ Pass adminId

    await logActivity(req, PANEL, MODULE, "update", result, result.status);
    // ✅ Send Notification
    await createNotification(
      req,
      "Camp  Updated",
      `Camp  was updated by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );

    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in updateCamp:", error);
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

exports.deleteHolidayCampDates = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  if (!id) {
    return res.status(400).json({ status: false, message: "ID is required." });
  }

  try {
    // ✅ Call the service to perform soft delete
    const result = await HolidayCampDateService.deleteHolidayCampDates(id, adminId);

    // ✅ Log the action
    await logActivity(req, PANEL, MODULE, "delete", result, result.status);

    // ✅ Notify if successful
    if (result.status) {
      await createNotification(
        req,
        "Camp Deleted",
        `Camp  was deleted by ${req?.admin?.firstName || "Admin"}.`,
        "System"
      );
    }

    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in deleteCamp Controller:", error);
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
