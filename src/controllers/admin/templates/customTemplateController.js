
const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");
const path = require("path");
const fs = require("fs");
const { uploadToFTP } = require("../../../utils/uploadToFTP");
const { saveFile } = require("../../../utils/fileHandler");
// const TemplateCategory = require("../../../../../services/admin/holidayCamps/emailAndTextTemplates/templateCategory/templateCategory");
const DEBUG = process.env.DEBUG === "true";
const CustomTemplate = require("../../../services/admin/templates/customTemplate");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const { getCustomTemplateById } = require("../../../services/admin/templates/customTemplate");
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
    const required = ["mode_of_communication", "title"];
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
    const categoryId = Array.isArray(template_category_id) ? template_category_id[0] : template_category_id;

    if (!categoryId) {
      return res.status(400).json({
        status: false,
        message: "template_category_id is required."
      });
    }

    // -------------------------
    // 4) Parse content JSON
    // -------------------------
    let parsedContent;
    try {
      parsedContent = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      return res.status(400).json({ status: false, message: "Invalid JSON in content." });
    }

    if (!parsedContent?.blocks || !Array.isArray(parsedContent.blocks)) parsedContent = { blocks: [] };

    // -------------------------
    // 5) Upload images
    // -------------------------
    const allowedExtensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "tiff"];
    const uploadedUrls = {};

    const filesArray = Array.isArray(files) ? files : Object.values(files).flat();

    for (const file of filesArray) {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
      }

      // Save file locally first
      const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
      const fileName = `${uniqueId}.${ext}`;
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
        if (publicUrl) uploadedUrls[file.fieldname] = publicUrl;
      } finally {
        await fs.promises.unlink(localPath).catch(() => { });
      }
    }

    // -------------------------
    // 6) Replace image URLs recursively
    // -------------------------
    function replaceImageUrls(blocks) {
      if (!blocks || !Array.isArray(blocks)) return;

      for (const block of blocks) {
        // Replace the url if it matches a key from uploaded files
        if (block.url && uploadedUrls[block.url]) {
          block.url = uploadedUrls[block.url];
        }

        // Recursively replace in columns (nested blocks)
        if (block.columns && Array.isArray(block.columns)) {
          for (const col of block.columns) {
            replaceImageUrls(col);
          }
        }
      }
    }

    replaceImageUrls(parsedContent.blocks);

    // -------------------------
    // 7) Prepare payload
    // -------------------------
    const payload = {
      title,
      mode_of_communication,
      template_category_id: categoryId,
      content: parsedContent,
      tags,
      createdBy: adminId
    };

    if (mode_of_communication === "text") payload.sender_name = sender_name;

    // -------------------------
    // 8) Call service to create template
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

// ✅ UPDATE Custom Template (Full Flow)
exports.updateCustomTemplate = async (req, res) => {
  const DEBUG = process.env.DEBUG === "true";
  const { id } = req.params;
  const formData = req.body || {};
  const files = req.files || [];
  const adminId = req.admin?.id;

  let { mode_of_communication, title, template_category_id, sender_name, content, tags } = formData;

  if (DEBUG) {
    console.log("📩 Incoming Body for Update:", formData);
    console.log("📁 Incoming Files:", files);
  }

  // -------------------------
  // 1) Validate Mode of Communication
  // -------------------------
  if (!["email", "text"].includes(mode_of_communication)) {
    await logActivity(req, PANEL, MODULE, "update", { message: "Invalid communication mode" }, false);
    return res.status(400).json({
      status: false,
      message: "mode_of_communication must be either 'email' or 'text'."
    });
  }

  // -------------------------
  // 2) Validate Required Fields
  // -------------------------
  const required = ["mode_of_communication", "title"];
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
  const categoryId = Array.isArray(template_category_id) ? template_category_id[0] : template_category_id;
  if (!categoryId) {
    return res.status(400).json({
      status: false,
      message: "template_category_id is required."
    });
  }

  // -------------------------
  // 4) Parse content JSON
  // -------------------------
  let parsedContent;
  try {
    parsedContent = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return res.status(400).json({ status: false, message: "Invalid JSON in content." });
  }
  if (!parsedContent?.blocks || !Array.isArray(parsedContent.blocks)) parsedContent = { blocks: [] };

  if (DEBUG) console.log("📝 Parsed Content:", parsedContent);

  // -------------------------
  // 5) Upload files
  // -------------------------
  const allowedExtensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "tiff"];
  const uploadedUrls = {};
  const filesArray = Array.isArray(files) ? files : Object.values(files).flat();

  for (const file of filesArray) {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (!allowedExtensions.includes(ext)) {
      return res.status(400).json({ status: false, message: `Invalid file type: ${file.originalname}` });
    }

    const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 1e9);
    const fileName = `${uniqueId}.${ext}`;
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
      if (publicUrl) uploadedUrls[file.fieldname] = publicUrl;
    } finally {
      await fs.promises.unlink(localPath).catch(() => { });
    }
  }

  if (DEBUG) console.log("🌐 Uploaded URLs:", uploadedUrls);

  // -------------------------
  // 6) Replace image URLs recursively (conditional)
  // -------------------------
  function replaceImageUrls(blocks) {
    if (!blocks || !Array.isArray(blocks)) return;

    for (const block of blocks) {
      if (block.url) {
        // Replace only if placeholder matches uploaded file
        if (uploadedUrls[block.url]) {
          block.url = uploadedUrls[block.url];
        }
        // If full URL already present, leave it as-is
        else if (block.url.startsWith("http")) {
          // do nothing
        } else {
          // optional: clear invalid placeholder
          block.url = "";
        }
      }

      // Recursively process columns in sectionGrid
      if (block.columns && Array.isArray(block.columns)) {
        for (const col of block.columns) replaceImageUrls(col);
      }
    }
  }

  replaceImageUrls(parsedContent.blocks);

  if (DEBUG) console.log("🔄 Content after URL replacement:", parsedContent);

  // -------------------------
  // 7) Prepare payload
  // -------------------------
  const payload = {
    title,
    mode_of_communication,
    template_category_id: categoryId,
    content: parsedContent,
    tags
  };
  if (mode_of_communication === "text") payload.sender_name = sender_name;

  if (DEBUG) console.log("📦 Payload for update:", payload);

  // -------------------------
  // 8) Call service to update
  // -------------------------
  try {
    const result = await CustomTemplate.updateCustomTemplate(id, payload, adminId);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update", { message: result.message }, false);
      return res.status(404).json({ status: false, message: result.message });
    }

    const adminFullName =
      req.admin?.name || `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() || "Unknown Admin";

    const msg = `Custom template updated successfully by ${adminFullName}`;

    await logActivity(req, PANEL, MODULE, "update", { message: "Updated successfully" }, true);
    await createNotification(req, "Custom Template Updated", msg, "Support");

    return res.status(200).json({
      status: true,
      message: "Custom template updated successfully.",
      data: result.data
    });

  } catch (error) {
    console.error("❌ Controller Error:", error);
    await logActivity(req, PANEL, MODULE, "update", { oneLineMessage: error.message }, false);
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
