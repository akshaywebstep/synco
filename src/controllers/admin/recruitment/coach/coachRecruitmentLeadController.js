const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const RecruitmentLeadService = require("../../../../services/admin/recruitment/coach/coachRecruitmentLead");
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
exports.createRecruitmentLead = async (req, res) => {
  if (DEBUG) console.log("▶️ Incoming Request Body:", req.body);

  const adminId = req.admin?.id || null;
  const isAdminRequest = Boolean(adminId);

  // -------------------------------
  // 🔍 Validate Input Fields
  // -------------------------------
  const validation = validateFormData(req.body, {
    requiredFields: [
      "firstName",
      "lastName",
      "dob",
      "email",
      "gender",
      "managementExperience",
      "qualification",
      // "availableVenues",
      // "heardFrom",
    ],
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({ status: false, ...validation });
  }

  try {
    // -------------------------------
    // 💾 Build Payload
    // -------------------------------
    const payload = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      dob: req.body.dob,
      age: req.body.age || null,
      gender: req.body.gender,
      email: req.body.email,
      phoneNumber: req.body.phoneNumber || null,
      postcode: req.body.postcode || null,
      managementExperience: req.body.managementExperience,
      qualification: req.body.qualification, // JSON / array
      // availableVenues: req.body.availableVenues, // JSON / array
      // heardFrom: req.body.heardFrom,
      status: "pending",
      appliedFor: "coach",
      message: req.body.message || null,
      // 🔐 SOURCE LOGIC (IMPORTANT)
      createdBy: isAdminRequest ? adminId : null,
      source: isAdminRequest ? "admin" : "website",
    };

    // -------------------------------
    // 💾 Create Lead
    // -------------------------------
    const result = await RecruitmentLeadService.createRecruitmentLead(payload);

    if (DEBUG) console.log("💾 Create Service Result:", result);

    // -------------------------------
    // 📝 Log Activity
    // -------------------------------
    await logActivity(req, PANEL, MODULE, "create", result, result.status);

    // -------------------------------
    // 🔔 Notification
    // -------------------------------
    if (isAdminRequest) {
      await createNotification(
        req,
        "Recruitment Lead Created",
        `Recruitment Lead created by ${req.admin.firstName}.`,
        "System"
      );
    }

    return res.status(201).json(result);
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

exports.createWebsiteCoachLead = async (req, res) => {
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
      appliedFor: "coach",
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
      availableVenueWork: req.body.candidate.availableVenueWork,
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

// exports.createRecruitmentLead = async (req, res) => {
//   if (DEBUG) console.log("▶️ Incoming Request Body:", req.body);

//   const {
//     firstName,
//     lastName,
//     dob,
//     age,
//     gender,
//     email,
//     phoneNumber,
//     postcode,
//     managementExperience,
//     qualification,
//     availableVenues,
//     heardFrom,
//     // dbs,
//     // level,
//   } = req.body;

//   const adminId = req.admin?.id;
//   if (DEBUG) console.log("▶️ Admin ID:", adminId);

//   // -------------------------------
//   // 🔍 Validate Input Fields
//   // -------------------------------
//   const validation = validateFormData(req.body, {
//     requiredFields: [
//       "firstName",
//       "lastName",
//       "dob",
//       "email",
//       "managementExperience",
//       // "dbs",
//       // "level",
//       "gender",
//       "qualification",
//       "availableVenues",
//       "heardFrom",
//     ],
//   });

//   if (DEBUG) console.log("🔍 Validation Result:", validation);

//   if (!validation.isValid) {
//     await logActivity(req, PANEL, MODULE, "create", validation.error, false);
//     return res.status(400).json({ status: false, ...validation });
//   }

//   try {
//     // -------------------------------
//     // 💾 Create Lead
//     // -------------------------------
//     if (DEBUG) console.log("💾 Creating Recruitment Lead…");

//     const result = await RecruitmentLeadService.createRecruitmentLead({
//       firstName,
//       lastName,
//       dob,
//       age,
//       email,
//       phoneNumber,
//       postcode,
//       managementExperience,
//       // dbs,
//       // level,
//       qualification,
//       availableVenues,
//       heardFrom,
//       gender,
//       status: "pending",
//       createdBy: adminId,
//       appliedFor: "coach",
//     });

//     if (DEBUG) console.log("💾 Create Service Result:", result);

//     // Log activity
//     await logActivity(req, PANEL, MODULE, "create", result, result.status);

//     // -------------------------------
//     // 🔔 Create Notification
//     // -------------------------------
//     await createNotification(
//       req,
//       "Recruitment Lead Created",
//       `Recruitment Lead created by ${req?.admin?.firstName || "Admin"}.`,
//       "System"
//     );

//     return res.status(result.status ? 201 : 500).json(result);
//   } catch (error) {
//     console.error("❌ Error in createRecruitmentLead:", error);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "create",
//       { oneLineMessage: error.message },
//       false
//     );

//     return res.status(500).json({
//       status: false,
//       message: "Server error.",
//       error: DEBUG ? error.message : undefined,
//     });
//   }
// };

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
    const result = await RecruitmentLeadService.getAllRecruitmentLead(
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
    const result = await RecruitmentLeadService.getRecruitmentLeadById(
      id,
      superAdminId
    ); // ✅ pass adminId
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

    // 👉 accept ?dateRange=thisMonth | lastMonth | last3Months | last6Months
    const { dateRange } = req.query;

    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized. Admin ID missing.",
      });
    }

    // 🔍 Find parent super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    if (!superAdminId) {
      return res.status(400).json({
        status: false,
        message: "Super admin not found for this admin.",
      });
    }

    // 📌 Call service with dateRange
    const result = await RecruitmentLeadService.getAllRecruitmentLeadRport(
      superAdminId,
      dateRange // 👈 replaced filterType
    );

    // 📝 Activity log
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
    const result = await RecruitmentLeadService.getAllCoachAndVmRecruitmentLead(
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

// ✅ Get all admins
exports.getAllVenueManager = async (req, res) => {
  if (DEBUG) console.log("📋 Request received to list all admins");
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  try {
    // const loggedInAdminId = req.admin?.id; // Get the current admin's ID

    const result = await RecruitmentLeadService.getAllVenueManager(
      superAdminId
    ); // Pass it to the service

    if (!result.status) {
      if (DEBUG)
        console.log("❌ Failed to retrieve venue manager:", result.message);

      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch venue manager.",
      });
    }

    if (DEBUG) {
      console.log(`✅ Retrieved ${result.data.length} admin(s)`);
      console.table(
        result.data.map((m) => ({
          ID: m.id,
          Name: m.name,
          Email: m.email,
          Created: m.createdAt,
        }))
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data.length} admin(s) successfully.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: `Fetched ${result.data.length} admin(s) successfully.`,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ List Admins Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch coaches. Please try again later.",
    });
  }
};
