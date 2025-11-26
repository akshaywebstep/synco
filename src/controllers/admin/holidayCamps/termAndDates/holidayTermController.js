const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const TermService = require("../../../../services/admin/holidayCamps/termAndDates/holidayTerm");
const { HolidayTerm } = require("../../../../models"); // ✅ Required models
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "term";

// ✅ CREATE TERM
exports.createHolidayTerm = async (req, res) => {
  const adminId = req.admin?.id;
  const {
    termName,
    termGroupId,
    day,
    startDate,
    endDate,
    totalNumberOfSessions,
    exclusionDates = [],
    sessionsMap = [],
    createdBy,
  } = req.body;

  if (DEBUG) {
    console.log("📥 Creating Term with Sessions:", req.body);
  }

  const validation = validateFormData(req.body, {
    requiredFields: [
      "termName",
      "termGroupId",
      // "day",
      "startDate",
      "endDate",
      "totalNumberOfSessions",
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
    const term = await HolidayTerm.create({
      termName,
      termGroupId,
      day,
      startDate,
      endDate,
      totalSessions: totalNumberOfSessions,
      exclusionDates, // JSON array
      sessionsMap, // JSON array of sessions
      createdBy: adminId,
    });

    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { message: "Term created" },
      true
    );
    // ✅ Send Notification
    await createNotification(
      req,
      "Term  Created",
      `Term  '${termName}' was created by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Term created successfully with sessions and exclusions.",
      data: term,
    });
  } catch (error) {
    console.error("❌ Error in createTerm:", error);
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

// ✅ GET ALL TERMS (admin-specific)
exports.getAllHolidayTerms = async (req, res) => {
  const adminId = req.admin?.id;
  if (!adminId) {
      return res
        .status(401)
        .json({ status: false, message: "Unauthorized. Admin ID missing." });
    }
  
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  
  try {
    const result = await TermService.getAllHolidayTerms(superAdminId);
    await logActivity(req, PANEL, MODULE, "list", result, result.status);
    return res.status(result.status ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ getAllTerms error:", error);
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

// ✅ GET TERM BY ID (admin-specific)
exports.getHolidayTermById = async (req, res) => {
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
    const result = await TermService.getHolidayTermById(id, superAdminId);
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
exports.updateHolidayTerm = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  const {
    termGroupId,
    termName,
    day,
    startDate,
    endDate,
    totalSessions,
    exclusionDates = [],
    sessionsMap = [],
  } = req.body;

  if (DEBUG) {
    console.log("🛠 Updating Term ID:", id);
    console.log("📥 Received Update FormData:", req.body);
  }

  if (!id) {
    await logActivity(req, PANEL, MODULE, "update", "ID is required", false);
    return res.status(400).json({ status: false, message: "ID is required." });
  }

  // ✅ Validate required fields
  const validation = validateFormData(req.body, {
    requiredFields: ["termGroupId", "termName", "startDate", "endDate"],
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
      termGroupId,
      termName,
      day,
      startDate,
      endDate,
      totalSessions,
      exclusionDates,
      sessionsMap,
    };

    const result = await TermService.updateHolidayTerm(id, updatePayload, adminId); // ✅ Pass adminId

    await logActivity(req, PANEL, MODULE, "update", result, result.status);
    // ✅ Send Notification
    await createNotification(
      req,
      "Term  Updated",
      `Term  '${termName}' was updated by ${req?.admin?.firstName || "Admin"}.`,
      "System"
    );

    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in updateTerm:", error);
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

exports.deleteHolidayTerm = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id;

  if (!id) {
    return res.status(400).json({ status: false, message: "ID is required." });
  }

  try {
    // ✅ Call the service to perform soft delete
    const result = await TermService.deleteHolidayTerm(id, adminId);

    // ✅ Log the action
    await logActivity(req, PANEL, MODULE, "delete", result, result.status);

    // ✅ Notify if successful
    if (result.status) {
      await createNotification(
        req,
        "Term Deleted",
        `Term ID '${id}' was deleted by ${req?.admin?.firstName || "Admin"}.`,
        "System"
      );
    }

    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in deleteTerm Controller:", error);
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
