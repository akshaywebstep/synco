const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const RecruitmentLeadService = require("../../../../services/admin/recruitment/coach/coachRecruitmentLead");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "recruitment-lead";

// ----------------------------------------
// ✅ CREATE RECRUITMENT LEAD
// ----------------------------------------

exports.createRecruitmentLead = async (req, res) => {
    if (DEBUG) console.log("▶️ Incoming Request Body:", req.body);

    const {
        firstName,
        lastName,
        dob,
        age,
        email,
        phoneNumber,
        postcode,
        managementExperience,
        dbs,
        level,
    } = req.body;

    const adminId = req.admin?.id;
    if (DEBUG) console.log("▶️ Admin ID:", adminId);

    // -------------------------------
    // 🔍 Validate Input Fields
    // -------------------------------
    const validation = validateFormData(req.body, {
        requiredFields: [
            "firstName",
            "lastName",
            "dob",
            "email",
            "managementExperience",
            "dbs",
            "level",
        ],
    });

    if (DEBUG) console.log("🔍 Validation Result:", validation);

    if (!validation.isValid) {
        await logActivity(req, PANEL, MODULE, "create", validation.error, false);
        return res.status(400).json({ status: false, ...validation });
    }

    try {
        // -------------------------------
        // 💾 Create Lead
        // -------------------------------
        if (DEBUG) console.log("💾 Creating Recruitment Lead…");

        const result = await RecruitmentLeadService.createRecruitmentLead({
            firstName,
            lastName,
            dob,
            age,
            email,
            phoneNumber,
            postcode,
            managementExperience,
            dbs,
            status: "pending",
            level,
            createdBy: adminId,
            appliedFor: "coach",
        });

        if (DEBUG) console.log("💾 Create Service Result:", result);

        // Log activity
        await logActivity(req, PANEL, MODULE, "create", result, result.status);

        // -------------------------------
        // 🔔 Create Notification
        // -------------------------------
        await createNotification(
            req,
            "Recruitment Lead Created",
            `Recruitment Lead created by ${req?.admin?.firstName || "Admin"}.`,
            "System"
        );

        return res.status(result.status ? 201 : 500).json(result);

    } catch (error) {
        console.error("❌ Error in createRecruitmentLead:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { oneLineMessage: error.message },
            false
        );

        return res.status(500).json({
            status: false,
            message: "Server error.",
            error: DEBUG ? error.message : undefined,
        });
    }
};

exports.getAllRecruitmentLead = async (req, res) => {
  const adminId = req.admin?.id;

  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await RecruitmentLeadService.getAllRecruitmentLead(superAdminId,); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "list", result, result.status);
    return res.status(result.status ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ Error in getAllRecruitmentLead:", error);
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

exports.getRecruitmentLeadById = async (req, res) => {
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
    const result = await RecruitmentLeadService.getRecruitmentLeadById(id, superAdminId); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "getById", result, result.status);
    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in getRecruitmentLeadById:", error);
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

exports.rejectRecruitmentLeadStatus = async (req, res) => {
  const { id } = req.params;  // recruitment lead id
  const adminId = req.admin?.id;

  if (!id) {
    return res.status(400).json({ status: false, message: "Recruitment Lead ID is required." });
  }

  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  try {
    // -----------------------------------
    // 🔧 SERVICE CALL
    // -----------------------------------
    const result = await RecruitmentLeadService.rejectRecruitmentStatusById(id, adminId);

    // Log Activity
    await logActivity(req, PANEL, MODULE, "reject", result, result.status);

    return res.status(result.status ? 200 : 400).json(result);

  } catch (error) {
    console.error("❌ Error in rejectRecruitmentLeadStatus:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "reject",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.sendEmail = async (req, res) => {
  const { recruitmentLeadId } = req.body;

  if (!Array.isArray(recruitmentLeadId) || recruitmentLeadId.length === 0) {
    return res.status(400).json({
      status: false,
      message: "recruitmentLeadId (array) is required",
    });
  }

  try {
    const results = await Promise.all(
      recruitmentLeadId.map(async (leadId) => {
        const result = await RecruitmentLeadService.sendEmail({
          recruitmentLeadId: leadId,
          admin: req.admin,
        });

        await logActivity(
          req,
          PANEL,
          MODULE,
          "send",
          { message: `Email attempt for recruitmentLeadId ${leadId}: ${result.message}` },
          result.status
        );

        return { recruitmentLeadId: leadId, ...result };
      })
    );

    const allSentTo = results.flatMap((r) => r.sentTo || []);

    return res.status(200).json({
      status: true,
      message: `Emails send candidate(s)`,
      results,
      sentTo: allSentTo,
    });
  } catch (error) {
    console.error("❌ Controller Send Email Error:", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "send",
      { error: error.message },
      false
    );

    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getAllRecruitmentLeadRport = async (req, res) => {
  try {
    const adminId = req.admin?.id;

    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized. Admin ID missing.",
      });
    }

    // 🔍 Get parent super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    if (!superAdminId) {
      return res.status(400).json({
        status: false,
        message: "Super admin not found for this admin.",
      });
    }

    // 📌 Service call
    const result = await RecruitmentLeadService.getAllRecruitmentLeadRport(
      superAdminId
    );

    // 📝 Activity Log
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { superAdminId },
      result.status
    );

    return res.status(result.status ? 200 : 400).json(result);

  } catch (error) {
    console.error("❌ Controller Error getAllRecruitmentLeadRport:", error);

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
      message: "Server error while fetching recruitment report.",
    });
  }
};

exports.getAllCoachAndVmRecruitmentLead = async (req, res) => {
  const adminId = req.admin?.id;

  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await RecruitmentLeadService.getAllCoachAndVmRecruitmentLead(superAdminId,); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "list", result, result.status);
    return res.status(result.status ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ Error in getAllRecruitmentLead:", error);
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

// ✅ Get All Venues
exports.getAllVenues = async (req, res) => {
  const createdBy = req.admin?.id;

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await RecruitmentLeadService.getAllVenues(superAdminId);

    await logActivity(req, PANEL, MODULE, "list", result, result.status);

    if (!result.status) {
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch venues.",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Venues fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Get All Venues Controller Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching venues.",
    });
  }
};