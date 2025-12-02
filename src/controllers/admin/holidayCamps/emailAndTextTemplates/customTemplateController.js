

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
    const formData = req.body;
    const { mode_of_communication, title, template_category_id, sender_name, content } = formData;

    // ✅ Strict mode check
    if (!["email", "text"].includes(mode_of_communication)) {
        await logActivity(req, PANEL, MODULE, "create", { message: "Invalid communication mode" }, false);
        return res.status(400).json({
            status: false,
            message: "mode_of_communication must be either email or text only.",
        });
    }

    // ✅ Validate required fields dynamically
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
        await logActivity(req, PANEL, MODULE, "create", { message: validation.error }, false);
        return res.status(400).json({
            status: false,
            error: validation.error,
            message: validation.message,
        });
    }

    try {
        // ✅ Allow content as JSON or text
        let parsedContent = content;
        if (typeof content === "string") {
            try {
                parsedContent = JSON.parse(content); // if valid JSON string → convert
            } catch {
                parsedContent = content; // otherwise keep as normal text
            }
        }

        // ✅ Prepare payload based on mode
        let payload = {
            title,
            mode_of_communication,
            template_category_id,
            createdBy: req.admin.id,
            content: parsedContent
        };

        if (mode_of_communication === "text") {
            payload.sender_name = sender_name;
        }

        // ❗ If email, ensure sender_name is NOT saved
        if (mode_of_communication === "email") {
            delete payload.sender_name;
        }

        const result = await CustomTemplate.createCustomTemplate(payload);

        if (!result?.status) {
            await logActivity(req, PANEL, MODULE, "create", { message: "Creation failed" }, false);
            return res.status(500).json({ status: false, message: "Failed to create custom template." });
        }

        await logActivity(req, PANEL, MODULE, "create", { message: "Created successfully" }, true);
        const adminFullName =
            req.admin?.name ||
            `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
            "Unknown Admin";
        const msg = `Custom template created successfully by ${adminFullName}`;

        await createNotification(req, "Custom Template Created", msg, "Support");

        return res.status(201).json({
            status: true,
            message: "Custom template created successfully.",
            data: result.data,
        });

    } catch (error) {
        console.error("❌ Error:", error);
        await logActivity(req, PANEL, MODULE, "create", { oneLineMessage: error.message }, false);
        return res.status(500).json({ status: false, message: "Server error." });
    }
};
// ✅ LIST API
exports.listCustomTemplates = async (req, res) => {
    const { template_category_id } = req.query;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);

    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
    if (DEBUG) console.log("📥 Listing all template categories");
    const result = await CustomTemplate.listCustomTemplates(superAdminId, template_category_id);

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
        const msg = `Custom template created successfully by ${adminFullName}`;
        await createNotification(req, "Custom Template Created", msg, "Support");
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

    // Strict mode check
    if (!["email", "text"].includes(mode_of_communication)) {
        await logActivity(req, PANEL, MODULE, "update", { message: "Invalid communication mode" }, false);
        return res.status(400).json({
            status: false,
            message: "mode_of_communication must be email or text only.",
        });
    }

    // Validate required fields dynamically
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
        // Allow content as JSON or text
        let parsedContent = content;
        if (typeof content === "string") {
            try {
                parsedContent = JSON.parse(content);
            } catch {
                parsedContent = content;
            }
        }

        // Prepare update payload
        let payload = {
            title,
            mode_of_communication,
            template_category_id,
            content: parsedContent,
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
