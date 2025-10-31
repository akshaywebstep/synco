
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

// ✅ Get All
exports.getAllOnetoOneLeads = async (req, res) => {
    if (DEBUG) console.log("📥 Fetching all One-to-One leads...");

    try {
        const adminId = req.admin.id;

        const result = await oneToOneLeadService.getAllOnetoOneLeads(adminId);

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res
                .status(500)
                .json({ status: false, message: result.message || "Failed to fetch leads." });
        }

        if (DEBUG) {
            console.log("✅ One-to-One leads fetched successfully");
            console.table(result.data);
        }

        // Log successful fetch
        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            {
                oneLineMessage: `Fetched ${result.data.length || 0} One-to-One leads for admin ${adminId}.`,
            },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Fetched One-to-One leads successfully.",
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
        });
    }
};

exports.getOnetoOneLeadsById = async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?.id; // Extract admin ID from auth middleware

  try {
    const result = await oneToOneLeadService.getOnetoOneLeadsById(id, adminId);

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
