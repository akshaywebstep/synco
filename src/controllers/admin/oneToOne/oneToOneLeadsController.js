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
      return res.status(400).json({
        success: false,
        message: `${validation.missingField} is required`
      });
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
      `Lead for ${formData.parentName} has been created by ${req?.admin?.firstName || "Admin"
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
        oneLineMessage: `Fetched ${result.data?.length || 0
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
      packageInterest: req.query.packageInterest,
      coach: req.query.coach,
      agent: req.query.agent,
      source: req.query.source,
      location: req.query.location,
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
        oneLineMessage: `Fetched ${result.data?.length || 0
          } One-to-One leads for admin ${adminId}.`,
      },
      true
    );

    // ✅ Include all relevant fields in API response
    return res.status(200).json({
      status: true,
      message: result.message || "Fetched One-to-One leads successfully.",
      summary: result.summary,
      locations: result.locations || [],
      locationSummary: result.locationSummary || {},
      agentList: result.agentList || [],
      coachList: result.coachList || [],
      data: result.data || [],
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
  if (DEBUG) console.log("📥 Filter...");

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
      packageInterest: req.query.packageInterest,
      coach: req.query.coach,
      agent: req.query.agent,
      source: req.query.source,
      location: req.query.location,
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
        oneLineMessage: `Fetched ${result.data?.length || 0
          } One-to-One leads for admin ${adminId}.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary: result.summary,
      locationSummary: result.locationSummary || {},
      locations: result.locations || [],
      agentList: result.agentList || [],
      coachList: result.coachList || [],
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
      superAdminId,
      adminId,
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

    // ============================================================
    // 🚫 Require at least one section
    // ============================================================
    if (
      updateData.student === undefined &&
      updateData.parentDetails === undefined &&
      updateData.emergencyDetails === undefined
    ) {
      return res.status(400).json({
        status: false,
        message:
          "At least one of student, parentDetails, or emergencyDetails is required.",
      });
    }

    // ============================================================
    // 🚫 FIELD VALIDATION (single field error)
    // ============================================================

    const validateObject = (obj) => {
      if (!obj) return null;
      for (const key in obj) {
        if (
          obj[key] === "" ||
          obj[key] === null ||
          obj[key] === undefined
        ) {
          return `${key} cannot be empty`;
        }
      }
      return null;
    };

    // Validate student array
    if (Array.isArray(updateData.student)) {
      for (let i = 0; i < updateData.student.length; i++) {
        const student = updateData.student[i];
        const err = validateObject(student);
        if (err) {
          return res.status(400).json({
            status: false,
            message: err,
          });
        }
      }
    }

    // Validate parent
    const parentError = validateObject(updateData.parentDetails);
    if (parentError) {
      return res.status(400).json({
        status: false,
        message: parentError,
      });
    }

    // Validate emergency
    const emergencyError = validateObject(updateData.emergencyDetails);
    if (emergencyError) {
      return res.status(400).json({
        status: false,
        message: emergencyError,
      });
    }

    // ============================================================
    // 🧹 CLEAN EMPTY FIELDS SAFELY (forbidden values removed)
    // ============================================================

    const cleanData = JSON.parse(
      JSON.stringify(updateData, (key, value) => {
        if (value === "" || value === null || value === undefined) {
          return undefined; // remove empty
        }
        return value;
      })
    );

    // ============================================================
    // 🧩 Fetch main super admin
    // ============================================================
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // ============================================================
    // 🛠 Update lead using service
    // ============================================================
    const updateResult = await oneToOneLeadService.updateOnetoOneLeadById(
      id,
      superAdminId,
      adminId,
      cleanData
    );

    if (!updateResult.status) {
      return res.status(400).json({
        status: false,
        message: updateResult.message || "Failed to update One-to-One Lead.",
      });
    }

    // ============================================================
    // 📝 Log activity
    // ============================================================
    await logActivity(req, PANEL, MODULE, "update", { id, updateData: cleanData }, true);

    // ============================================================
    // 🔔 Create notification
    // ============================================================
    const adminName = `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }`.trim();

    await createNotification(
      req,
      "One-to-One Lead Updated",
      `Lead was updated by ${adminName}.`,
      "Support"
    );

    // ============================================================
    // ✅ Success response
    // ============================================================
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

// exports.updateOnetoOneLeadById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const adminId = req.admin?.id;
//     const updateData = req.body;

//     if (DEBUG) console.log("🔹 Received request to update lead:", { id, adminId, updateData });

//     if (!id) {
//       if (DEBUG) console.log("⚠️ Lead ID is missing in request params");
//       return res.status(400).json({
//         status: false,
//         message: "Lead ID is required.",
//       });
//     }

//     if (
//       !updateData.student &&
//       !updateData.parentDetails &&
//       !updateData.emergencyDetails
//     ) {
//       if (DEBUG) console.log("⚠️ No update data provided");
//       return res.status(400).json({
//         status: false,
//         message:
//           "At least one of student, parentDetails, or emergencyDetails is required.",
//       });
//     }

//     // 🔹 Get main super admin of current admin
//     const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
//     const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
//     if (DEBUG) console.log("🔹 Super Admin ID fetched:", superAdminId);

//     // ✅ Call service to update lead
//     if (DEBUG) console.log("🔹 Calling service to update lead...");
//     const updateResult = await oneToOneLeadService.updateOnetoOneLeadById(
//       id,
//       superAdminId,
//       adminId,
//       updateData
//     );
//     if (DEBUG) console.log("🔹 Service returned:", updateResult);

//     if (!updateResult.status) {
//       if (DEBUG) console.log("⚠️ Update failed:", updateResult.message);
//       return res.status(400).json({
//         status: false,
//         message: updateResult.message || "Failed to update One-to-One Lead.",
//       });
//     }

//     // Log admin activity
//     if (DEBUG) console.log("🔹 Logging admin activity...");
//     await logActivity(req, PANEL, MODULE, "update", { id, updateData }, true);

//     // Create notification
//     const adminName = `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""}`.trim();
//     if (DEBUG) console.log(`🔹 Creating notification for admin: ${adminName}`);
//     await createNotification(
//       req,
//       "One-to-One Lead Updated",
//       `Lead ID ${id} was updated by ${adminName}.`,
//       "Support"
//     );

//     // Success response
//     if (DEBUG) console.log("✅ Lead update successful");
//     return res.status(200).json({
//       status: true,
//       message: "One-to-One Lead updated successfully.",
//       data: updateResult.data,
//     });
//   } catch (error) {
//     if (DEBUG) console.error("❌ Error updating One-to-One Lead:", error);
//     return res.status(500).json({
//       status: false,
//       message: "Server error while updating One-to-One Lead.",
//     });
//   }
// };

// ✅ Get One-to-One Analytics
exports.getAllOneToOneAnalytics = async (req, res) => {
  const adminId = req.admin?.id;
  const { filterType = "thisMonth" } = req.query; // 👈 e.g. ?filterType=last3Months

  if (DEBUG) console.log("📊 Fetching One-to-One analytics...");

  try {
    // 🧩 Validate admin
    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // 🧩 Identify Super Admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // ✅ Call service with filterType
    const result = await oneToOneLeadService.getAllOneToOneAnalytics(
      superAdminId,
      adminId,
      filterType // 👈 FIXED
    );

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "analytics_list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch analytics.",
      });
    }

    // 🧾 Log success
    await logActivity(
      req,
      PANEL,
      MODULE,
      "analytics_list",
      {
        oneLineMessage: `Fetched analytics summary for admin ${adminId}.`,
      },
      true
    );

    // ✅ Respond
    return res.status(200).json({
      status: true,
      message: `Fetched One-to-One analytics (${filterType}) successfully.`,
      summary: result.summary,
      charts: result.charts,
      dateRange: result.dateRange,
    });
  } catch (error) {
    console.error("❌ Server error (getAllOneToOneAnalytics):", error);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "analytics_list",
      { oneLineMessage: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error while fetching analytics.",
      error: DEBUG ? error.message : undefined,
    });
  }
};

exports.sendEmailToFirstParentWithBooking = async (req, res) => {
  console.log("📩 [Controller] sendEmailToFirstParentWithBooking() called");
  try {
    console.log("📥 Request body received:", req.body);
    const { leadIds } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      console.warn("⚠️ No valid leadIds provided in request body.");
      return res.status(400).json({ status: false, message: "Please provide at least one valid leadId in the request body." });
    }

    console.log("✅ Valid leadIds received:", leadIds);

    console.log("🚀 Calling service: sendEmailToFirstParentWithBooking()");
    const result = await oneToOneLeadService.sendEmailToFirstParentWithBooking(leadIds);

    console.log("📤 Service response received:", JSON.stringify(result, null, 2));

    if (!result.status) {
      console.warn("❌ Service returned failure:", result.message);
      return res.status(400).json({ status: false, message: result.message, skipped: result.skipped || [], errors: result.errors || [] });
    }

    console.log(`✅ Successfully sent ${result.totalSent} emails.`);
    if (result.sentTo?.length) console.log("📧 Emails sent to:", result.sentTo);
    if (result.skipped?.length) console.log("⏭️ Skipped leads:", result.skipped);
    if (result.errors?.length) console.error("⚠️ Errors during email sending:", result.errors);

    return res.status(200).json({ status: true, message: result.message, totalSent: result.totalSent, sentTo: result.sentTo, skipped: result.skipped, errors: result.errors });
  } catch (error) {
    console.error("❌ sendEmailToFirstParentWithBookingController Error:", error);
    return res.status(500).json({ status: false, message: error.message || "Internal server error while sending emails." });
  }
};
