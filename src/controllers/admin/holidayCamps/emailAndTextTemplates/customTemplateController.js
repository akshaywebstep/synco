

const { validateFormData } = require("../../../../utils/validateFormData");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
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

    const {
      mode_of_communication,
      title,
      template_category_id,
      sender_name,
      content
    } = formData;

    console.log("📩 Incoming Body:", req.body);

    /* -------------------------------------------------------
     * 1) Validate Mode of Communication
     * ------------------------------------------------------ */
    if (!["email", "text"].includes(mode_of_communication)) {
      await logActivity(req, PANEL, MODULE, "create", { message: "Invalid communication mode" }, false);
      return res.status(400).json({
        status: false,
        message: "mode_of_communication must be either 'email' or 'text'."
      });
    }

    /* -------------------------------------------------------
     * 2) Validate Required Fields
     * ------------------------------------------------------ */
    let required = ["mode_of_communication", "title"];

    if (mode_of_communication === "text") required.push("sender_name", "content");
    if (mode_of_communication === "email") required.push("content");

    const missing = required.filter(f => !formData[f]);

    if (missing.length) {
      const msg = `Missing required fields: ${missing.join(", ")}`;
      await logActivity(req, PANEL, MODULE, "create", { message: msg }, false);

      return res.status(400).json({
        status: false,
        message: msg
      });
    }

    /* -------------------------------------------------------
     * 3) Normalize category IDs (ALWAYS ARRAY)
     * ------------------------------------------------------ */
    let categoryIds = template_category_id;

    if (!Array.isArray(categoryIds)) {
      categoryIds = template_category_id ? [template_category_id] : [];
    }

    if (categoryIds.length === 0) {
      return res.status(400).json({
        status: false,
        message: "template_category_id is required."
      });
    }

    /* -------------------------------------------------------
     * 4) Parse content (JSON or plain string)
     * ------------------------------------------------------ */
    let parsedContent = content;
    if (typeof content === "string") {
      try {
        parsedContent = JSON.parse(content);
      } catch {
        parsedContent = content;
      }
    }

    /* -------------------------------------------------------
     * 5) Final Payload (Convert categoryIds to STRING)
     * ------------------------------------------------------ */
    const payload = {
      title,
      mode_of_communication,
      template_category_id: JSON.stringify(categoryIds),   // IMPORTANT ✔
      content: parsedContent,
      createdBy: req.admin?.id
    };

    if (mode_of_communication === "text") {
      payload.sender_name = sender_name;
    }

    /* -------------------------------------------------------
     * 6) Call Service Layer
     * ------------------------------------------------------ */
    const result = await CustomTemplate.createCustomTemplate(payload);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", { message: result.message }, false);
      return res.status(500).json({
        status: false,
        message: result.message
      });
    }

    /* -------------------------------------------------------
     * 7) Log Activity + Notification
     * ------------------------------------------------------ */
    const adminName =
      req.admin?.name ||
      `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
      "Unknown Admin";

    const notifMsg = `Custom template created successfully by ${adminName}`;

    await createNotification(req, "Custom Template Created", notifMsg, "Support");

    await logActivity(req, PANEL, MODULE, "create", { message: "Template created successfully" }, true);

    /* -------------------------------------------------------
     * 8) SUCCESS RESPONSE
     * ------------------------------------------------------ */
    return res.status(201).json({
      status: true,
      message: "Custom template created successfully.",
      data: result.data
    });

  } catch (error) {
    console.error("❌ Controller Error:", error);

    await logActivity(req, PANEL, MODULE, "create", { oneLineMessage: error.message }, false);

    return res.status(500).json({
      status: false,
      message: "Internal server error."
    });
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
    const { mode_of_communication, title, template_category_id, sender_name, content } = formData;

    // ✅ Strict mode check
    if (!["email", "text"].includes(mode_of_communication)) {
        await logActivity(req, PANEL, MODULE, "update", { message: "Invalid communication mode" }, false);
        return res.status(400).json({
            status: false,
            message: "mode_of_communication must be email or text only.",
        });
    }

    // ✅ Convert to array
    let categoryIds = template_category_id;
    if (!Array.isArray(categoryIds)) {
        categoryIds = [template_category_id];
    }

    // ✅ Validation
    const rules = {
        requiredFields: ["mode_of_communication", "title", "template_category_id"],
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
        // ✅ Parse content
        let parsedContent = content;
        if (typeof content === "string") {
            try {
                parsedContent = JSON.parse(content);
            } catch {
                parsedContent = content;
            }
        }

        // ✅ Payload
        let payload = {
            title,
            mode_of_communication,
            template_category_id: categoryIds,
            content: parsedContent
        };

        if (mode_of_communication === "text") {
            payload.sender_name = sender_name;
        }

        if (mode_of_communication === "email") {
            delete payload.sender_name;
        }

        const result = await CustomTemplate.updateCustomTemplate(id, payload, req.admin.id);

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "update", { message: result.message }, false);
            return res.status(404).json({ status: false, message: result.message });
        }

        const adminFullName =
            req.admin?.name ||
            `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
            "Unknown Admin";

        const msg = `Custom template updated successfully by ${adminFullName}`;

        await logActivity(req, PANEL, MODULE, "update", { message: "Updated successfully" }, true);
        await createNotification(req, "Custom Template Updated", msg, "Support");

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
