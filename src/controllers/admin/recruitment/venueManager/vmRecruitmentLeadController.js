const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const RecruitmentLeadService = require("../../../../services/admin/recruitment/venueManager/vmRecruitmentLead");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");
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
    gender,
    email,
    phoneNumber,
    postcode,
    managementExperience,
    qualification,
    // dbs,
    // level,
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
      "qualification",
      // "dbs",
      // "level",
      "gender",
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
      gender,
      email,
      phoneNumber,
      postcode,
      managementExperience,
      qualification,
      // dbs,
      status: "pending",
      // level,
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

exports.createWebsiteVmLead = async (req, res) => {
  if (DEBUG) console.log("▶️ Website Lead Request:", req.body);

  // ----------------------------------
  // 🔍 VALIDATE LEAD INPUT
  // ----------------------------------
  const validation = validateFormData(req.body.lead, {
    requiredFields: [
      "firstName",
      "lastName",
      "dob",
      "email",
      "phoneNumber",
      "postcode",
    ],
  });

  if (!validation.isValid) {
    return res.status(400).json({ status: false, ...validation });
  }

  try {
    // ----------------------------------
    // 📦 BUILD LEAD PAYLOAD (WEBSITE)
    // ----------------------------------
    const leadPayload = {
      firstName: req.body.lead.firstName,
      lastName: req.body.lead.lastName,
      dob: req.body.lead.dob,
      email: req.body.lead.email,
      phoneNumber: req.body.lead.phoneNumber || null,
      postcode: req.body.lead.postcode || null,
      qualification: req.body.lead.qualification || null,
      // 🔒 WEBSITE FIXED VALUES
      status: "pending",
      appliedFor: "venue manager",
      source: "website",
      createdBy: null,
    };

    // ----------------------------------
    // 📦 BUILD CANDIDATE PAYLOAD
    // ----------------------------------
    const candidatePayload = {
      howDidYouHear: req.body.candidate.howDidYouHear,
      ageGroupExperience: req.body.candidate.ageGroupExperience,
      accessToOwnVehicle: req.body.candidate.accessToOwnVehicle,
      whichQualificationYouHave: req.body.candidate.whichQualificationYouHave,
      footballExperience: req.body.candidate.footballExperience,
      fullWeekendAvailablity: req.body.candidate.fullWeekendAvailablity,
      uploadCv: req.body.candidate.uploadCv,
      coverNote: req.body.candidate.coverNote,
    };

    // ----------------------------------
    // 🚀 CALL WEBSITE SERVICE
    // ----------------------------------
    const result = await RecruitmentLeadService.createLeadAndCandidate(
      leadPayload,
      candidatePayload
    );

    return res.status(201).json(result);
  } catch (error) {
    console.error("❌ Website lead error:", error);
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
    const result = await RecruitmentLeadService.getAllVmRecruitmentLead(
      superAdminId
    ); // ✅ pass adminId
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
    const result = await RecruitmentLeadService.getVmRecruitmentLeadById(
      id,
      superAdminId
    ); // ✅ pass adminId
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

exports.rejectRecruitmentLeadStatus = async (req, res) => {
  const { id } = req.params; // recruitment lead id
  const adminId = req.admin?.id;

  if (!id) {
    return res
      .status(400)
      .json({ status: false, message: "Recruitment Lead ID is required." });
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
    const result = await RecruitmentLeadService.rejectRecruitmentStatusById(
      id,
      adminId
    );

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
          {
            message: `Email attempt for recruitmentLeadId ${leadId}: ${result.message}`,
          },
          result.status
        );

        return { recruitmentLeadId: leadId, ...result };
      })
    );

    const allSentTo = results.flatMap((r) => r.sentTo || []);

    return res.status(200).json({
      status: true,
      message: `Emails send succesfully`,
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

exports.getAllVmRecruitmentLeadRport = async (req, res) => {
  try {
    const adminId = req.admin?.id;
    // 👉 accept ?dateRange=thisMonth | lastMonth | last3Months | last6Months
    const { dateRange } = req.query;
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
    const result = await RecruitmentLeadService.getAllVmRecruitmentLeadRport(
      superAdminId,
      dateRange
    );

    // 📝 Activity Log
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { superAdminId, dateRange },
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
