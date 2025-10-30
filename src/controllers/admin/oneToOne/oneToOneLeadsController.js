
const { validateFormData } = require("../../../utils/validateFormData");
const oneToOneLeadService = require("../../../services/admin/oneToOne//oneToOneLeadsService");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
    createNotification,
} = require("../../../utils/admin/notificationHelper");

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
            return res.status(400).json(validation);
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
            `Lead for ${formData.parentName} has been created by ${req?.admin?.firstName || "Admin"} ${req?.admin?.lastName || ""}.`,
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