const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const RecruitmentLeadService = require("../../../../services/admin/recruitment/venueManager/vmRecruitmentLead");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "recruitment-lead";

// ----------------------------------------
// ✅ CREATE RECRUITMENT LEAD
// ----------------------------------------

exports.createVmRecruitmentLead = async (req, res) => {
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

        const result = await RecruitmentLeadService.createRecruitmentVmLead({
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
            appliedFor: "venue manager",
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

exports.getAllVmRecruitmentLead = async (req, res) => {
  const adminId = req.admin?.id;

  if (!adminId) {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized. Admin ID missing." });
  }

  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await RecruitmentLeadService.getAllVmRecruitmentLead(superAdminId,); // ✅ pass adminId
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

exports.getVmRecruitmentLeadById = async (req, res) => {
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
    const result = await RecruitmentLeadService.getVmRecruitmentLeadById(id, superAdminId); // ✅ pass adminId
    await logActivity(req, PANEL, MODULE, "getById", result, result.status);
    return res.status(result.status ? 200 : 404).json(result);
  } catch (error) {
    console.error("❌ Error in getVmRecruitmentLeadById:", error);
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
