const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const { generatePasswordHint, getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const { validateFormData } = require("../../../utils/validateFormData");

const coachService = require("../../../services/admin/coaches/coachProfile");

const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");

// Set DEBUG flag
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "coach";

// ✅ Get all admins
exports.getAllCoaches = async (req, res) => {
  if (DEBUG) console.log("📋 Request received to list all admins");
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  try {
    // const loggedInAdminId = req.admin?.id; // Get the current admin's ID

    const result = await coachService.getAllCoaches(superAdminId); // Pass it to the service

    if (!result.status) {
      if (DEBUG) console.log("❌ Failed to retrieve coaches:", result.message);

      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to fetch coaches.",
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
        oneLineMessage: `Fetched ${result.data.length} coach(s) successfully.`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: `Fetched ${result.data.length} coach(s) successfully.`,
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

// ✅ Get Coach by ID
exports.getCoachById = async (req, res) => {
  if (DEBUG) console.log("📋 Request received to fetch coach by ID");

  try {
    const coachId = req.params.id;

    if (DEBUG) console.log(`🔍 Coach ID from request: ${coachId}`);

    // Get super admin for access control
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    if (DEBUG) console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);

    // Fetch coach details
    const result = await coachService.getCoachById(coachId, superAdminId);

    if (!result.status) {
      if (DEBUG)
        console.log("❌ Failed to retrieve coach:", result.message);

      await logActivity(req, PANEL, MODULE, "view", result, false);
      return res.status(404).json({
        status: false,
        message: result.message || "Coach not found.",
      });
    }

    const coach = result.data;

    if (DEBUG) {
      console.log("✅ Coach found:");
      console.table({
        ID: coach.id,
        FullName: coach.firstName + " " + coach.lastName,
        Email: coach.email,
        Role: coach.role?.role,
      });
    }

    // Activity logging
    await logActivity(
      req,
      PANEL,
      MODULE,
      "view",
      { oneLineMessage: `Fetched coach '${coach.firstName}' successfully.` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Coach fetched successfully.",
      data: coach,
    });
  } catch (error) {
    console.error("❌ Get Coach Error:", error);

    return res.status(500).json({
      status: false,
      message: "Failed to fetch coach. Please try again later.",
    });
  }
};

exports.createAllocateVenue = async (req, res) => {
  const formData = req.body;

  if (DEBUG) console.log("📥 Allocating Venue - Data:", formData);

  const validation = validateFormData(formData, {
    requiredFields: ["venueId", "rate","coachId"]
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({
      status: false,
      message: validation.message,
      error: validation.error,
    });
  }

  try {
    // ✅ Inject createdBy from admin
    formData.createdBy = req.admin?.id;

    const result = await coachService.createAllocateVenue(formData);

    await logActivity(req, PANEL, MODULE, "create", result, result.status);

    // ✅ Create Notification
    await createNotification(
      req,
      "Allocate Venue for coach",
      `Venue has been allocated to coach`,
      "System"
    );

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    return res.status(201).json({
      status: true,
      message: "Venue allocated successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Create createAllocateVenue Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while createAllocateVenue.",
    });
  }
};

exports.updateAllocateVenue = async (req, res) => {
  const { id } = req.params;
  const formData = req.body;

  if (DEBUG) console.log("📤 Updating Venue Allocation - Data:", formData);

  const validation = validateFormData(formData, {
    requiredFields: ["venueId", "rate"],
  });

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "update", validation.error, false);
    return res.status(400).json({
      status: false,
      message: validation.message,
      error: validation.error,
    });
  }

  try {
    // ✅ Inject updatedBy from admin
    formData.updatedBy = req.admin?.id;

    const result = await coachService.updateAllocateVenue(id, formData);

    await logActivity(req, PANEL, MODULE, "update", result, result.status);

    // If ID not found
    if (!result.status && result.message === "Allocation record not found.") {
      return res.status(404).json({
        status: false,
        message: "Allocation record not found.",
      });
    }

    if (!result.status) {
      return res.status(500).json({
        status: false,
        message: result.message,
      });
    }

    // ✅ Create Notification
    await createNotification(
      req,
      "Update Venue Allocation",
      `Venue allocation updated successfully.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: "Venue allocation updated successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Update updateAllocateVenue Error:", error);

    return res.status(500).json({
      status: false,
      message: "Server error while updateAllocateVenue.",
    });
  }
};

exports.deleteAllocateVenue = async (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(Number(id))) {
    return res.status(400).json({
      status: false,
      message: "Invalid venue allocation ID.",
    });
  }

  try {
    const adminId = req.admin?.id;

    const result = await coachService.deleteAllocateVenue(id, adminId);

    await logActivity(req, PANEL, MODULE, "delete", result, result.status);

    if (!result.status) {
      return res.status(404).json({
        status: false,
        message: result.message,
      });
    }

    // Notification
    await createNotification(
      req,
      "Delete Venue Allocation",
      `Venue allocation has been deleted.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: "Venue allocation deleted successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Controller deleteAllocateVenue Error:", error);

    return res.status(500).json({
      status: false,
      message: "Server error while deleteAllocateVenue.",
    });
  }
};

// ✅ Download Coach Qualification
exports.downloadCoachQualification = async (req, res) => {
  if (DEBUG)
    console.log("📥 Request received to download coach qualification");

  try {
    const coachId = req.params.coachId;
    const qualificationType = req.params.type;

    if (DEBUG)
      console.log(`🔍 CoachId: ${coachId}, Qualification: ${qualificationType}`);

    // Get Super Admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin?.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    if (DEBUG)
      console.log(`🧩 SuperAdminId resolved as: ${superAdminId}`);

    const result = await coachService.getCoachQualificationFile(
      coachId,
      superAdminId,
      qualificationType
    );

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "download", result, false);

      return res.status(404).json({
        status: false,
        message: result.message,
      });
    }

    const { fileUrl, fileName } = result.data;

    // 🔹 Fetch file as stream
    const fileResponse = await axios({
      url: fileUrl,
      method: "GET",
      responseType: "stream",
    });

    const ext = path.extname(fileUrl);
    const downloadName =
      fileName || `${qualificationType}_qualification${ext}`;

    // 🔹 Force download headers
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName}"`
    );
    res.setHeader(
      "Content-Type",
      fileResponse.headers["content-type"] || "application/octet-stream"
    );

    await logActivity(
      req,
      PANEL,
      MODULE,
      "download",
      {
        oneLineMessage: `Downloaded qualification '${qualificationType}' for coach ID ${coachId}`,
      },
      true
    );

    // 🔹 Pipe file to client
    fileResponse.data.pipe(res);

  } catch (error) {
    console.error("❌ Controller downloadCoachQualification Error:", error);

    return res.status(500).json({
      status: false,
      message: "Failed to download qualification file. Please try again later.",
    });
  }
};