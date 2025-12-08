const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const RecruitmentLeadService = require("../../../../services/admin/recruitment/franchise/franchiseRecruitmentLead");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "recruitment-franchise-lead";

// ----------------------------------------
// ✅ CREATE RECRUITMENT LEAD
// ----------------------------------------

exports.createRecruitmentFranchiseLead = async (req, res) => {
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

        const result = await RecruitmentLeadService.createRecruitmentFranchiseLead({
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
            appliedFor: "franchise",
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

exports.getAllFranchiseRecruitmentLead = async (req, res) => {
  const adminId = req.admin?.id;

  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await RecruitmentLeadService.getAllFranchiseRecruitmentLead(superAdminId,); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "list", result, result.status);
    return res.status(result.status ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ Error in getAllFranchiseRecruitmentLead:", error);
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

exports.getFranchiseRecruitmentLeadById = async (req, res) => {
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
    const result = await RecruitmentLeadService.getFranchiseRecruitmentLeadById(id, superAdminId); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "getById", result, result.status);
    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in getFranchiseRecruitmentLeadById:", error);
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

exports.rejectFranchiseRecruitmentStatusById = async (req, res) => {
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
    const result = await RecruitmentLeadService.rejectFranchiseRecruitmentStatusById(id, adminId);

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

exports.sendOfferEmail = async (req, res) => {
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
        const result = await RecruitmentLeadService.sendOfferEmail({
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