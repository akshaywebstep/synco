const { validateFormData } = require("../../../../utils/validateFormData");
const FolderService = require("../../../../services/admin/administration/folder/folder");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const {
  createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "folder";

exports.createFolder = async (req, res) => {
  const formData = req.body;

  const {
    name,
    createdBy,
  } = formData;

  if (DEBUG) {
    console.log("📥 STEP 1: Received request to create a new folder");
    console.log("📝 Form Data:", formData);
  }

  const validation = validateFormData(formData, {
    requiredFields: [
      "name",
    ],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ STEP 2: Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", validation.error, false);
    return res.status(400).json({
      status: false,
      error: validation.error,
      message: validation.message,
    });
  }

  try {
    const result = await FolderService.createFolder({
      name,
      createdBy: req.admin.id,
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ STEP 3: Creation failed:", result.message);
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to create folder.",
      });
    }

    if (DEBUG) console.log("✅ STEP 4: folder created:", result.data);
    await logActivity(req, PANEL, MODULE, "create", result, true);

    // ✅ Construct admin full name safely
    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    // ✅ Fixed notification message
    const msg = `folder "${name}" created successfully ${adminFullName}`;

    await createNotification(req, "Folder Created", msg, "Support");

    return res.status(201).json({
      status: true,
      message: "Folder created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ STEP 5: Server error during creation:", error);
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

exports.getAllFolders = async (req, res) => {
  const adminId = req.admin?.id;

  if (DEBUG)
    console.log(`📁 Getting all folders for admin ID: ${adminId}`);

  // Get main super admin of the logged-in admin
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

  try {
    const result = await FolderService.getAllFolders(superAdminId);

    // Log the activity
    await logActivity(req, PANEL, MODULE, "getAll", result, result.status);

    if (!result.status) {
      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getAllFolders Error:", error);

    await logActivity(req, PANEL, MODULE, "getAll", error, false);

    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};
