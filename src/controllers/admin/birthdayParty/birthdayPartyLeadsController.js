const { validateFormData } = require("../../../utils/validateFormData");
const birthdayPartyLeadService = require("../../../services/admin/birthdayParty/birthdayPartyLeadsService");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
  createNotification,
  createCustomNotificationForAdmins,
} = require("../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "birthday-party-leads";

// exports.createBirthdayPartyLeads = async (req, res) => {
//   try {
//     const formData = req.body;

//     // ✅ Validate required fields
//     const validation = validateFormData(formData, {
//       requiredFields: [
//         "parentName",
//         "childName",
//         "age",
//         "partyDate",
//         "packageInterest",
//         "source",
//       ],
//     });

//     if (!validation.isValid) {
//       return res.status(400).json({
//         success: false,
//         message: `${validation.missingField} is required`
//       });
//     }

//     // ✅ Create the lead
//     const createResult = await birthdayPartyLeadService.createBirthdayPartyLeads({
//       parentName: formData.parentName,
//       childName: formData.childName,
//       age: formData.age,
//       partyDate: formData.partyDate,
//       packageInterest: formData.packageInterest,
//       source: formData.source,
//       status: "pending", // Default
//       createdBy: req.admin.id,
//     });

//     if (!createResult.status) {
//       return res.status(500).json({
//         status: false,
//         message: createResult.message || "Failed to create lead.",
//       });
//     }

//     // ✅ Log activity
//     await logActivity(req, PANEL, MODULE, "create", createResult.data, true);

//     // ✅ Correct notification format
//     await createNotification(
//       req,
//       "New Birthday Party Lead Added",
//       `Lead for ${formData.parentName} has been created by ${req?.admin?.firstName || "Admin"
//       } ${req?.admin?.lastName || ""}.`,
//       "Support"
//     );

//     // ✅ Respond with success
//     return res.status(201).json({
//       status: true,
//       message: "Birthday Party Lead created successfully.",
//       data: createResult.data,
//     });
//   } catch (error) {
//     console.error("❌ Server error:", error);
//     return res.status(500).json({
//       status: false,
//       message: "Server error.",
//     });
//   }
// };

// ✅ Get Leads
exports.createBirthdayPartyLeads = async (req, res) => {
  try {
    const formData = req.body;

    // ✅ Validation
    const validation = validateFormData(formData, {
      requiredFields: ["parentName", "childName", "age", "partyDate"],
    });

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: `${validation.missingField} is required`,
      });
    }

    const createdBy = req?.admin?.id || null;

    // ✅ Create lead
    const createResult =
      await birthdayPartyLeadService.createBirthdayPartyLeads({
        parentName: formData.parentName,
        childName: formData.childName,
        age: formData.age,
        partyDate: formData.partyDate,
        packageInterest: formData.packageInterest || null,
        source: formData.source || "Website",
        phoneNumber: formData.phoneNumber || null,
        email: formData.email || null,
        postCode: formData.postCode || null,
        availableDays: formData.availableDays || null,
        notes: formData.notes || null,
        status: "pending",
        createdBy,
      });

    if (!createResult.status) {
      return res.status(500).json({
        status: false,
        message: createResult.message || "Failed to create lead.",
      });
    }

    // ✅ ONLY ADMIN-CREATED → log + notify
    if (createdBy) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "create",
        createResult.data,
        true
      );

      await createNotification(
        req,
        "New Birthday Party Lead Added",
        `Lead for ${formData.parentName} has been created by ${req.admin.firstName || "Admin"
        } ${req.admin.lastName || ""}.`,
        "Support"
      );
    }

    return res.status(201).json({
      status: true,
      message: "Birthday Party Lead created successfully.",
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

// Assign Booking to Admin / Agent
exports.assignBookings = async (req, res) => {
  try {
    const { leadIds, createdBy } = req.body;

    // ✅ Validation
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Lead IDs array is required.",
      });
    }

    if (!createdBy || isNaN(Number(createdBy))) {
      return res.status(400).json({
        status: false,
        message: "Valid agent ID is required.",
      });
    }

    // ✅ Call service
    const result = await birthdayPartyLeadService.assignBookingsToAgent({
      leadIds,
      createdBy,
    });

    // ❌ Service failed (e.g. already assigned)
    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update", result, false);
      return res.status(400).json(result);
    }

    // ✅ Notification (success only)
    await createNotification(
      req,
      "Lead Assigned",
      `${leadIds.length} lead(s) assigned to agent successfully.`,
      "System"
    );

    // ✅ Activity log (success)
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      {
        oneLineMessage: `Assigned ${leadIds.length} lead(s) to admin ${createdBy}`,
      },
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Assign bookings controller error:", error);

    return res.status(500).json({
      status: false,
      message: error.message || "Failed to assign bookings.",
    });
  }
};

exports.getAllBirthdayPartyLeads = async (req, res) => {
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
      partyDate: req.query.partyDate,
      packageInterest: req.query.packageInterest,
    };

    // ✅ Fetch data (pass both admin and superAdmin)
    const result = await birthdayPartyLeadService.getAllBirthdayPartyLeads(
      superAdminId,
      adminId,
      filters
    );

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      // await logActivity(req, PANEL, MODULE, "list", result, false);
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
exports.getAllBirthdayPartyLeadsSales = async (req, res) => {
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
    };

    // ✅ Fetch data (pass both admin and superAdmin)
    const result = await birthdayPartyLeadService.getAllBirthdayPartyLeadsSales(
      superAdminId,
      adminId,
      filters
    );

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      // await logActivity(req, PANEL, MODULE, "list", result, false);
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
exports.getAllBirthdayPartyLeadsSalesAll = async (req, res) => {
  const adminId = req.admin?.id;
  if (DEBUG) console.log("📥 Fetching all Birthday Party leads...");

  try {
    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin ID not found.",
      });
    }

    // Identify super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // Collect filters
    const filters = {
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      type: req.query.type,
      studentName: req.query.studentName,
      packageInterest: req.query.packageInterest,
      partyDate: req.query.partyDate,
      source: req.query.source,
      agent: req.query.agent,
      coach: req.query.coach,
      address: req.query.address,
    };

    // Get data from service
    const result = await birthdayPartyLeadService.getAllBirthdayPartyLeadsSalesAll(
      superAdminId,
      adminId,
      filters
    );

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch birthday party leads.",
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      {
        oneLineMessage: `Fetched ${result.data?.length || 0} Birthday Party leads for admin ${adminId}.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched Birthday Party leads successfully.",
      summary: result.summary,
      agentList: result.agentList,
      coachList: result.coachList,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Server error (getAllBirthdayPartyLeadsSalesAll):", error);

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
      message: "Server error while fetching Birthday Party leads.",
      error: DEBUG ? error.message : undefined,
    });
  }
};

exports.getBirthdayPartyLeadsById = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // Extract admin ID from auth middleware

  try {
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
    const result = await birthdayPartyLeadService.getBirthdayPartyLeadsById(
      id,
      superAdminId,
      adminId,
    );

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "getById", result, false);
      return res.status(404).json({
        status: false,
        message: result.message || "Birthday party lead not found or unauthorized.",
      });
    }

    await logActivity(req, PANEL, MODULE, "getById", result, true);
    return res.status(200).json({
      status: true,
      message: "Fetched birthday party lead successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error in getBirthdayPartyLeadsById:", error);
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

exports.updateBirthdayPartyLeadById = async (req, res) => {
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
    // 🚫 Require at least one valid section
    // ============================================================
    if (
      updateData.student === undefined &&
      updateData.parentDetails === undefined &&
      updateData.emergencyDetails === undefined
    ) {
      return res.status(400).json({
        status: false,
        message: "At least one of student, parentDetails, or emergencyDetails is required.",
      });
    }

    // ============================================================
    // 🚫 FIELD VALIDATION (FIRST ERROR ONLY)
    // ============================================================

    const validateFields = (obj) => {
      if (!obj) return null;

      for (const key in obj) {
        const value = obj[key];
        if (value === "" || value === null || value === undefined) {
          return `${key} cannot be empty`;
        }
      }
      return null;
    };

    // Student array validation
    if (Array.isArray(updateData.student)) {
      for (let i = 0; i < updateData.student.length; i++) {
        const student = updateData.student[i];

        for (const key in student) {
          if (
            student[key] === "" ||
            student[key] === null ||
            student[key] === undefined
          ) {
            return res.status(400).json({
              status: false,
              message: `${key} cannot be empty`,
            });
          }
        }
      }
    }

    // Parent Details
    const parentError = validateFields(updateData.parentDetails);
    if (parentError) {
      return res.status(400).json({
        status: false,
        message: parentError,
      });
    }

    // Emergency
    const emergencyError = validateFields(updateData.emergencyDetails);
    if (emergencyError) {
      return res.status(400).json({
        status: false,
        message: emergencyError,
      });
    }

    // ============================================================
    // 🧹 CLEAN EMPTY VALUES BEFORE SAVING
    // ============================================================
    const cleanData = JSON.parse(
      JSON.stringify(updateData, (key, value) => {
        if (value === "" || value === null || value === undefined) return undefined;
        return value;
      })
    );

    // ============================================================
    // 🛠 Update Lead (IMPORTANT: service MUST update only provided fields)
    // ============================================================
    const updateResult =
      await birthdayPartyLeadService.updateBirthdayPartyLeadById(
        id,
        req.admin?.superAdminId || null,
        adminId,
        cleanData
      );

    if (!updateResult.status) {
      return res.status(400).json({
        status: false,
        message: updateResult.message || "Failed to update Birthday party Lead.",
      });
    }

    // ============================================================
    // 🔔 Parent Admin Notification (One-to-One Lead Updated)
    // ============================================================
    try {
      if (updateResult.parentAdminId) {
        await createCustomNotificationForAdmins({
          title: "Birthday Party Booking Updated",
          description: "Your booking details have been updated by our team.",
          category: "Updates",
          createdByAdminId: adminId,
          recipientAdminIds: [updateResult.parentAdminId],
        });

        console.log("🔔 Parent admin notified:", updateResult.parentAdminId);
      }
    } catch (err) {
      console.error("❌ Parent admin notification failed:", err.message);
    }

    // ============================================================
    // 📝 Logging
    // ============================================================
    await logActivity(req, PANEL, MODULE, "update", { id, updateData: cleanData }, true);

    const adminName = `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""}`.trim();
    await createNotification(
      req,
      "Birthday Party Lead Updated",
      `Lead was updated by ${adminName}.`,
      "Support"
    );

    return res.status(200).json({
      status: true,
      message: "Birthday Party Lead updated successfully.",
      data: updateResult.data,
    });

  } catch (error) {
    console.error("❌ Error updating Birthday Party Lead:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while updating Birthday Party Lead.",
    });
  }
};

// exports.updateBirthdayPartyLeadById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const adminId = req.admin?.id;
//     const updateData = req.body;

//     if (!id) {
//       return res.status(400).json({
//         status: false,
//         message: "Lead ID is required.",
//       });
//     }

//     // ✅ Optional validation (you can expand if needed)
//     if (
//       !updateData.student &&
//       !updateData.parentDetails &&
//       !updateData.emergencyDetails
//     ) {
//       return res.status(400).json({
//         status: false,
//         message:
//           "At least one of student, parentDetails, or emergencyDetails is required.",
//       });
//     }

//     // ✅ Call service to update lead
//     const updateResult = await birthdayPartyLeadService.updateBirthdayPartyLeadById(
//       id,
//       req.admin?.superAdminId || null,
//       adminId,
//       updateData
//     );

//     if (!updateResult.status) {
//       return res.status(400).json({
//         status: false,
//         message: updateResult.message || "Failed to update Birthday party Lead.",
//       });
//     }

//     // ✅ Log admin activity
//     await logActivity(req, PANEL, MODULE, "update", { id, updateData }, true);

//     // ✅ Create notification
//     const adminName = `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
//       }`.trim();
//     await createNotification(
//       req,
//       "Birthday Party Lead Updated",
//       `Lead ID ${id} was updated by ${adminName}.`,
//       "Support"
//     );

//     // ✅ Success response
//     return res.status(200).json({
//       status: true,
//       message: "Birthday Party Lead updated successfully.",
//       data: updateResult.data,
//     });
//   } catch (error) {
//     console.error("❌ Error updating Birthday Party Lead:", error);
//     return res.status(500).json({
//       status: false,
//       message: "Server error while updating One-to-One Lead.",
//     });
//   }
// };

// ✅ Get One-to-One Analytics
exports.getAllBirthdayPartyAnalytics = async (req, res) => {
  const adminId = req.admin?.id;
  const { filterType } = req.query;// 👈 e.g. ?filterType=last3Months

  if (DEBUG) console.log("📊 Fetching Birthday Party analytics...");

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
    const result = await birthdayPartyLeadService.getAllBirthdayPartyAnalytics(
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
      message: `Fetched Birthday party analytics (${filterType}) successfully.`,
      summary: result.summary,
      charts: result.charts,
      dateRange: result.dateRange,
    });
  } catch (error) {
    console.error("❌ Server error (getAllBirthdayPartyAnalytics):", error);

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
    // 🧾 Step 1: Validate input
    console.log("📥 Request body received:", req.body);

    const { leadIds } = req.body; // Expecting an array of leadIds in the body

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      console.warn("⚠️ No valid leadIds provided in request body.");
      return res.status(400).json({
        status: false,
        message: "Please provide at least one valid leadId in the request body.",
      });
    }

    console.log(`✅ Valid leadIds received:`, leadIds);

    // 🧠 Step 2: Call service function
    console.log("🚀 Calling service: birthdayPartyLeadService.sendEmailToFirstParentWithBooking()");
    const result = await birthdayPartyLeadService.sendEmailToFirstParentWithBooking(leadIds);
    console.log("📤 Service response received:", JSON.stringify(result, null, 2));

    // 🧱 Step 3: Handle failed result
    if (!result.status) {
      console.warn("❌ Service returned failure:", result.message);
      return res.status(400).json({
        status: false,
        message: result.message || "Failed to send booking emails.",
        skipped: result.skipped || [],
        errors: result.errors || [],
      });
    }

    // ✅ Step 4: Handle success result
    console.log(`✅ Successfully sent emails.`);
    if (result.sentTo?.length) {
      console.log("📧 Emails sent to:", result.sentTo);
    }
    if (result.skipped?.length) {
      console.log("⏭️ Skipped leads:", result.skipped);
    }
    if (result.errors?.length) {
      console.error("⚠️ Errors during email sending:", result.errors);
    }

    return res.status(200).json({
      status: true,
      message: result.message,
      totalSent: result.totalSent,
      sentTo: result.sentTo,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    // 🧨 Step 5: Handle controller-level error
    console.error("❌ sendEmailToFirstParentWithBookingController Error:", error);
    return res.status(500).json({
      status: false,
      message: error.message || "Internal server error while sending emails.",
    });
  }
};

exports.cancelBirthdayPartyLeadAndBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id;

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Lead ID is required.",
      });
    }

    // ============================================================
    // 🧩 Fetch main super admin
    // ============================================================
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // ============================================================
    // 🛠 Call service → ONLY STATUS UPDATE
    // ============================================================
    const updateResult =
      await birthdayPartyLeadService.cancelBirthdayPartyLeadAndBooking(
        id,
        superAdminId,
        adminId
      );

    if (!updateResult.status) {
      return res.status(400).json({
        status: false,
        message: updateResult.message || "Failed to cancel One-to-One Lead.",
      });
    }
    // ================= customCreateNotification
    try {
      if (updateResult.parentAdminId) {
        await createCustomNotificationForAdmins({
          title: "Birthday Party Booking Cancelled",
          description: "Your booking has been cancelled by our team.",
          category: "Updates",
          createdByAdminId: adminId,
          recipientAdminIds: [updateResult.parentAdminId],
        });

        console.log("🔔 Parent notification sent:", updateResult.parentAdminId);
      }
    } catch (err) {
      console.error("❌ Parent notification failed:", err.message);
    }

    // ============================================================
    // 📝 Log activity
    // ============================================================
    await logActivity(
      req,
      PANEL,
      MODULE,
      "cancel",
      { id },
      true
    );

    // ============================================================
    // 🔔 Create notification
    // ============================================================
    const adminName = `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }`.trim();

    await createNotification(
      req,
      "Birthday Party Lead Cancelled",
      `Lead was cancelled by ${adminName}.`,
      "Support"
    );

    // ============================================================
    // ✅ Success response
    // ============================================================
    return res.status(200).json({
      status: true,
      message: "Lead and booking cancelled successfully.",
    });

  } catch (error) {
    console.error("❌ Error cancelling Birthday Party Lead:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while cancelling Birthday Party Lead.",
    });
  }
};

exports.renewBirthdayPartyLeadAndBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin?.id;

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Lead ID is required.",
      });
    }

    // ============================================================
    // 🧩 Fetch main super admin
    // ============================================================
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // ============================================================
    // 🛠 Call service → ONLY STATUS UPDATE
    // ============================================================
    const updateResult =
      await birthdayPartyLeadService.renewBirthdayPartyLeadAndBooking(
        id,
        superAdminId,
        adminId
      );

    if (!updateResult.status) {
      return res.status(400).json({
        status: false,
        message: updateResult.message || "Failed to renew package Birthday Party Lead.",
      });
    }

    // ================= customCreateNotification
    try {
      if (updateResult.parentAdminId) {
        await createCustomNotificationForAdmins({
          title: "Birthday Party Booking Renewed",
          description: "Your booking has been renewed by our team.",
          category: "Updates",
          createdByAdminId: adminId,
          recipientAdminIds: [updateResult.parentAdminId],
        });
        console.log("🔔 Parent notification sent:", updateResult.parentAdminId);
      }
    } catch (err) {
      console.error("❌ Parent notification failed:", err.message);
    }

    // ============================================================
    // 📝 Log activity
    // ============================================================
    await logActivity(
      req,
      PANEL,
      MODULE,
      "cancel",
      { id },
      true
    );

    // ============================================================
    // 🔔 Create notification
    // ============================================================
    const adminName = `${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""
      }`.trim();

    await createNotification(
      req,
      "Birthday Party Lead Renew",
      `Lead was renew by ${adminName}.`,
      "Support"
    );

    // ============================================================
    // ✅ Success response
    // ============================================================
    return res.status(200).json({
      status: true,
      message: "Lead and booking renew successfully.",
    });

  } catch (error) {
    console.error("❌ Error renew Birthday Party Lead:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while renew Birthday Party Lead.",
    });
  }
};