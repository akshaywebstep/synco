

const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
// const TemplateCategory = require("../../../../holidayCamps/emailAndTextTemplates/templateCategory/templateCategory");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const TemplateCategory = require("../../../services/admin/templates/templateCategory");
const DEBUG = process.env.DEBUG === "true";
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const PANEL = "admin";
const MODULE = "template-category";

// ✅ CREATE Template Category
// ✅ CREATE Template Category (Controller)
exports.createTemplateCategory = async (req, res) => {
  const formData = req.body;
  const { category } = formData;

  if (DEBUG) {
    console.log("📥 STEP 1: Received request to create a new template category");
    console.log("📝 Form Data:", formData);
  }

  // ✅ Validate request body
  const validation = validateFormData(formData, {
    requiredFields: ["category"],
  });

  if (!validation.isValid) {
    if (DEBUG) console.log("❌ STEP 2: Validation failed:", validation.error);
    await logActivity(req, PANEL, MODULE, "create", { message: validation.error }, false);

    return res.status(400).json({
      status: false,
      message: validation.message,
      error: validation.error,
    });
  }

  try {
    // ✅ Call SERVICE (not model directly)
    const result = await TemplateCategoryService.createTemplateCategory({
      category,
      createdBy: req.admin.id
    });

    if (!result.status) {
      if (DEBUG) console.log("⚠️ STEP 3: Service creation failed");
      await logActivity(req, PANEL, MODULE, "create", { message: result.message }, false);

      return res.status(500).json({
        status: false,
        message: result.message || "Failed to create template category."
      });
    }

    if (DEBUG) console.log("✅ STEP 4: Template Category created:", result.data);

    await logActivity(req, PANEL, MODULE, "create", { message: "Created successfully" }, true);

    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    const msg = `Template Category created successfully by ${adminFullName}`;

    await createNotification(req, "Template Category Created", msg, "Support");

    return res.status(201).json({
      status: true,
      message: "Template category created successfully.",
      data: result.data
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

    return res.status(500).json({
      status: false,
      message: "Server error."
    });
  }
};

exports.listTemplateCategories = async (req, res) => {
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  if (DEBUG) console.log("📥 Listing all template categories");

  const result = await TemplateCategory.listTemplateCategories(superAdminId); // ✅ FIX HERE

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "list", { message: result.message }, false);
    return res.status(500).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "list", { message: "Fetched successfully" }, true);
  return res.status(200).json({ status: true, data: result.data });
};

// ✅ DELETE template category (soft delete)
// exports.deleteTemplateCategory = async (req, res) => {
//   const { id } = req.params;

//   if (DEBUG) console.log(`📥 Deleting template category ID: ${id}`);

//   const result = await deleteTemplateCategory(id, req.admin.id);

//   if (!result.status) {
//     await logActivity(req, PANEL, MODULE, "delete", { message: result.message }, false);
//     return res.status(404).json({ status: false, message: result.message });
//   }

//   await logActivity(req, PANEL, MODULE, "delete", { message: result.message }, true);
//   return res.status(200).json({ status: true, message: result.message });
// };