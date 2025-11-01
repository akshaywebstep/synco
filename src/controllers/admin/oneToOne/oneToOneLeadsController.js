const { validateFormData } = require("../../../utils/validateFormData");
const oneToOneLeadService = require("../../../services/admin/oneToOne//oneToOneLeadsService");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "one-to-one-leads";

exports.createOnetoOneLeads = async (req, res) => {
  try {
    const formData = req.body;

    // ✅ Validate required fields
    const validation = validateFormData(formData, {
      requiredFields: [
        "parentName",
        "childName",
        "age",
        "postCode",
        "packageInterest",
        "availability",
        "source",
      ],
    });

    if (!validation.isValid) {
      return res.status(400).json(validation);
    }

    // ✅ Create the lead
    const createResult = await oneToOneLeadService.createOnetoOneLeads({
      parentName: formData.parentName,
      childName: formData.childName,
      age: formData.age,
      postCode: formData.postCode,
      packageInterest: formData.packageInterest,
      availability: formData.availability,
      source: formData.source,
      status: "pending", // Default
      createdBy: req.admin.id,
    });

    if (!createResult.status) {
      return res.status(500).json({
        status: false,
        message: createResult.message || "Failed to create lead.",
      });
    }

    // ✅ Log activity
    await logActivity(req, PANEL, MODULE, "create", createResult.data, true);

    // ✅ Correct notification format
    await createNotification(
      req,
      "New One-to-One Lead Added",
      `Lead for ${formData.parentName} has been created by ${
        req?.admin?.firstName || "Admin"
      } ${req?.admin?.lastName || ""}.`,
      "Support"
    );

    // ✅ Respond with success
    return res.status(201).json({
      status: true,
      message: "One-to-One Lead created successfully.",
      data: createResult.data,
    });
  } catch (error) {
    console.error("❌ Server error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error.",
    });
  }
};

// ✅ Get Leads
exports.getAllOnetoOneLeads = async (req, res) => {
  const adminId = req.admin?.id;
  if (DEBUG) console.log("📥 Fetching all One-to-One leads...");
  try {
    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // ✅ Identify super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    const filters = {
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      type: req.query.type,
      studentName: req.query.studentName,
    };

    // ✅ Fetch data (pass both admin and superAdmin)
    const result = await oneToOneLeadService.getAllOnetoOneLeads(
      superAdminId,
      adminId,
      filters
    );

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch leads.",
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${
          result.data?.length || 0
        } One-to-One leads for admin ${adminId}.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary: result.summary,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Server error (getAllOnetoOneLeads):", error);

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
      message: "Server error while fetching leads.",
      error: DEBUG ? error.message : undefined,
    });
  }
};

// ✅ Get Sales
exports.getAllOnetoOneLeadsSales = async (req, res) => {
  const adminId = req.admin?.id;
  if (DEBUG) console.log("📥 Fetching all One-to-One leads...");
  try {
    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // ✅ Identify super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    const filters = {
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      type: req.query.type,
      studentName: req.query.studentName,
    };

    // ✅ Fetch data (pass both admin and superAdmin)
    const result = await oneToOneLeadService.getAllOnetoOneLeadsSales(
      superAdminId,
      adminId,
      filters
    );

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch leads.",
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${
          result.data?.length || 0
        } One-to-One leads for admin ${adminId}.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary: result.summary,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Server error (getAllOnetoOneLeads):", error);

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
      message: "Server error while fetching leads.",
      error: DEBUG ? error.message : undefined,
    });
  }
};

// ✅ Get Sales and Leads
exports.getAllOnetoOneLeadsSalesAll = async (req, res) => {
  const adminId = req.admin?.id;
  if (DEBUG) console.log("📥 Fetching all One-to-One leads...");
  try {
    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // ✅ Identify super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    const filters = {
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      type: req.query.type,
      studentName: req.query.studentName,
    };

    // ✅ Fetch data (pass both admin and superAdmin)
    const result = await oneToOneLeadService.getAllOnetoOneLeadsSalesAll(
      superAdminId,
      adminId,
      filters
    );

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch leads.",
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${
          result.data?.length || 0
        } One-to-One leads for admin ${adminId}.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary: result.summary,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Server error (getAllOnetoOneLeads):", error);

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
      message: "Server error while fetching leads.",
      error: DEBUG ? error.message : undefined,
    });
  }
};

exports.getOnetoOneLeadsById = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // Extract admin ID from auth middleware

  try {
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
    const result = await oneToOneLeadService.getOnetoOneLeadsById(
      id,
      superAdminId
    );

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "getById", result, false);
      return res.status(404).json({
        status: false,
        message: result.message || "One-to-one lead not found or unauthorized.",
      });
    }

    await logActivity(req, PANEL, MODULE, "getById", result, true);
    return res.status(200).json({
      status: true,
      message: "Fetched one-to-one lead successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error in getOnetoOneLeadsById:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({
      status: false,
      message: "Internal server error.",
    });
  }
};

exports.updateOnetoOneLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Lead ID is required.",
      });
    }

    // ✅ Optional validation (you can expand if needed)
    if (
      !updateData.student &&
      !updateData.parentDetails &&
      !updateData.emergencyDetails
    ) {
      return res.status(400).json({
        status: false,
        message:
          "At least one of student, parentDetails, or emergencyDetails is required.",
      });
    }

    // ✅ Call service to update lead
    const updateResult = await oneToOneLeadService.updateOnetoOneLeadById(
      id,
      adminId,
      updateData
    );

    if (!updateResult.status) {
      return res.status(400).json({
        status: false,
        message: updateResult.message || "Failed to update One-to-One Lead.",
      });
    }

    // ✅ Log admin activity
    await logActivity(req, PANEL, MODULE, "update", { id, updateData }, true);

    // ✅ Create notification
    const adminName = `${req?.admin?.firstName || "Admin"} ${
      req?.admin?.lastName || ""
    }`.trim();
    await createNotification(
      req,
      "One-to-One Lead Updated",
      `Lead ID ${id} was updated by ${adminName}.`,
      "Support"
    );

    // ✅ Success response
    return res.status(200).json({
      status: true,
      message: "One-to-One Lead updated successfully.",
      data: updateResult.data,
    });
  } catch (error) {
    console.error("❌ Error updating One-to-One Lead:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while updating One-to-One Lead.",
    });
  }
};
