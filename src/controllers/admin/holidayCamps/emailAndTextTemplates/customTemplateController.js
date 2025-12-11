

const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
const path = require("path");
const fs = require("fs");
const { uploadToFTP } = require("../../../../utils/uploadToFTP");
const { saveFile } = require("../../../../utils/fileHandler");
// const TemplateCategory = require("../../../../../services/admin/holidayCamps/emailAndTextTemplates/templateCategory/templateCategory");
const DEBUG = process.env.DEBUG === "true";
const CustomTemplate = require("../../../../services/admin/holidayCamps/emailAndTextTemplates/customTemplate");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const { getCustomTemplateById } = require("../../../../services/admin/holidayCamps/emailAndTextTemplates/customTemplate");
const PANEL = "admin";
const MODULE = "custom-template";

// ✅ CREATE Template Category
exports.createCustomTemplate = async (req, res) => {
  try {
    const formData = req.body || {};
    const files = req.files || [];
    const adminId = req.admin?.id;

    let {
      mode_of_communication,
      title,
      template_category_id,
      sender_name,
      content,
      tags,
    } = formData;

    console.log("📩 Incoming Body:", req.body);

    // -------------------------
    // 1) Validate Mode of Communication
    // -------------------------
    if (!["email", "text"].includes(mode_of_communication)) {
      return res.status(400).json({
        status: false,
        message: "mode_of_communication must be either 'email' or 'text'."
      });
    }

    // -------------------------
    // 2) Validate Required Fields
    // -------------------------
    let required = ["mode_of_communication", "title"];
    if (mode_of_communication === "text") required.push("sender_name", "content");
    if (mode_of_communication === "email") required.push("content");

    const missing = required.filter(f => !formData[f]);
    if (missing.length) {
      return res.status(400).json({
        status: false,
        message: `Missing required fields: ${missing.join(", ")}`
      });
    }

    // -------------------------
    // 3) Normalize category IDs
    // -------------------------
    let categoryIds = Array.isArray(template_category_id) ? template_category_id : [template_category_id];
    if (categoryIds.length === 0) {
      return res.status(400).json({
        status: false,
        message: "template_category_id is required."
      });
    }

    // -------------------------
    // 4) Parse content (JSON)
    // -------------------------
    let parsedContent;
    try {
      parsedContent = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      parsedContent = content;
    }

    // -------------------------
    // 5) Upload images from req.files and add to content
    // -------------------------
    let uploadedUrls = [];

    // Normalize files array
    let filesArray = Array.isArray(files) ? files : Object.values(files).flat();

    const allowedExtensions = ["jpg","jpeg","png","webp","gif","bmp","svg","tiff"];
    for (const file of filesArray) {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
      }
    }

    for (const file of filesArray) {
      const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `${uniqueId}${ext}`;

      const localPath = path.join(
        process.cwd(),
        "uploads",
        "temp",
        "admin",
        `${adminId}`,
        "templates",
        fileName
      );

      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await saveFile(file, localPath);

      try {
        const remotePath = `uploads/temp/admin/${adminId}/templates/${fileName}`;
        const publicUrl = await uploadToFTP(localPath, remotePath);
        if (publicUrl) uploadedUrls.push(publicUrl);
      } finally {
        await fs.promises.unlink(localPath).catch(() => {});
      }
    }

    // Add uploaded image URLs to content.blocks
    if (uploadedUrls.length > 0) {
      if (!parsedContent?.blocks) parsedContent = { blocks: [] };
      uploadedUrls.forEach(url => {
        parsedContent.blocks.push({
          id: `img_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
          type: "image",
          content: "",
          url,
          placeholder: ""
        });
      });
    }

    // -------------------------
    // 6) Prepare payload
    // -------------------------
    const payload = {
      title,
      mode_of_communication,
      template_category_id: JSON.stringify(categoryIds),
      content: parsedContent,
      tags,
      createdBy: adminId
    };

    if (mode_of_communication === "text") payload.sender_name = sender_name;

    // -------------------------
    // 7) Call service
    // -------------------------
    const result = await CustomTemplate.createCustomTemplate(payload);

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    return res.status(201).json({
      status: true,
      message: "Custom template created successfully.",
      data: result.data
    });

  } catch (error) {
    console.error("❌ Controller Error:", error);
    return res.status(500).json({ status: false, message: "Internal server error." });
  }
};

// ✅ LIST API
exports.listCustomTemplates = async (req, res) => {
  const { template_category_id } = req.query;

  if (DEBUG) console.log("📥 Listing all template categories");

  const result = await CustomTemplate.listCustomTemplates(req.admin.id, template_category_id);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "list", { message: result.message }, false);
    return res.status(500).json({ status: false, message: result.message, data: [] });
  }

  await logActivity(req, PANEL, MODULE, "list", { message: "Fetched successfully" }, true);
  return res.status(200).json({ status: true, data: result.data });
};

// ✅ DELETE API
exports.deleteCustomTemplate = async (req, res) => {
  const { id } = req.params;
  const result = await CustomTemplate.deleteCustomTemplate(id, req.admin.id);

  if (!result.status) {
    await logActivity(req, PANEL, MODULE, "delete", { message: result.message }, false);

    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    const msg = `Custom template delete failed by ${adminFullName}`;

    await createNotification(req, "Custom Template Delete Failed", msg, "Support");

    return res.status(404).json({ status: false, message: result.message });
  }

  await logActivity(req, PANEL, MODULE, "delete", { message: result.message }, true);
  return res.status(200).json({ status: true, message: result.message });
};

// ✅ UPDATE API
exports.updateCustomTemplate = async (req, res) => {
  const { id } = req.params;
  const formData = req.body;
  const { mode_of_communication, title, template_category_id, sender_name, content, tags } = formData;

  // -------------------------------------------
  // 1) Validate communication mode
  // -------------------------------------------
  if (!["email", "text"].includes(mode_of_communication)) {
    await logActivity(req, PANEL, MODULE, "update", { message: "Invalid communication mode" }, false);
    return res.status(400).json({
      status: false,
      message: "mode_of_communication must be email or text only.",
    });
  }

  // -------------------------------------------
  // 2) Normalize category IDs (ALWAYS ARRAY)
  // -------------------------------------------
  let categoryIds = [];

  if (Array.isArray(template_category_id)) {
    categoryIds = template_category_id;
  } else if (template_category_id) {
    categoryIds = [template_category_id];
  }

  if (categoryIds.length === 0) {
    return res.status(400).json({
      status: false,
      message: "template_category_id is required."
    });
  }

  // -------------------------------------------
  // 3) Required field rules
  // -------------------------------------------
  const rules = {
    requiredFields: ["mode_of_communication", "title"],
  };

  if (mode_of_communication === "text") {
    rules.requiredFields.push("sender_name", "content");
  }

  if (mode_of_communication === "email") {
    rules.requiredFields.push("content");
  }

  const validation = validateFormData(formData, rules);

  if (!validation.isValid) {
    await logActivity(req, PANEL, MODULE, "update", { message: validation.error }, false);
    return res.status(400).json({
      status: false,
      error: validation.error,
      message: validation.message,
    });
  }

  try {
    // -------------------------------------------
    // 4) Parse content if JSON string
    // -------------------------------------------
    let parsedContent = content;
    if (typeof content === "string") {
      try {
        parsedContent = JSON.parse(content);
      } catch {
        parsedContent = content; // Keep as normal string
      }
    }

    // -------------------------------------------
    // 5) Build payload (IMPORTANT PART)
    // -------------------------------------------
    const payload = {
      title,
      tags,
      mode_of_communication,
      template_category_id: JSON.stringify(categoryIds),  // MUST be STRING for DB column
      content: parsedContent
    };

    if (mode_of_communication === "text") {
      payload.sender_name = sender_name;
    } else {
      delete payload.sender_name;
    }

    // -------------------------------------------
    // 6) Call service
    // -------------------------------------------
    const result = await CustomTemplate.updateCustomTemplate(id, payload, req.admin.id);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update", { message: result.message }, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    // -------------------------------------------
    // 7) Notification & Logs
    // -------------------------------------------
    const adminFullName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    const msg = `Custom template updated successfully by ${adminFullName}`;

    await logActivity(req, PANEL, MODULE, "update", { message: "Updated successfully" }, true);
    await createNotification(req, "Custom Template Updated", msg, "Support");

    // -------------------------------------------
    // 8) SUCCESS RESPONSE
    // -------------------------------------------
    return res.status(200).json({
      status: true,
      message: "Custom template updated successfully.",
      data: result.data,
    });

  } catch (error) {
    console.error("❌ Error:", error);
    await logActivity(req, PANEL, MODULE, "update", { oneLineMessage: error.message }, false);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ FETCH BY ID API
exports.getCustomTemplate = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await CustomTemplate.getCustomTemplateById(id, req.admin.id);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "view", { message: result.message }, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "view", { message: "Fetched successfully" }, true);
    return res.status(200).json({
      status: true,
      data: result.data,
    });

  } catch (error) {
    console.error("❌ Error:", error);
    await logActivity(req, PANEL, MODULE, "view", { message: error.message }, false);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};
