const { validateFormData } = require("../../../utils/validateFormData");
const StarterPack = require("../../../services/admin/payment/starterPack");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const {
    createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "starter-pack";


// ✅ Create Starter Pack
exports.createStarterPack = async (req, res) => {
    const formData = req.body;
    console.log("REQ BODY:", req.body);
    const {
        title,
        description,
        price,
        enabled,
        mandatory,
        appliesOnTrialConversion,
        appliesOnDirectMembership,
    } = formData;

    if (DEBUG) {
        console.log("📥 STEP 1: Received request to create a new starter pack");
        console.log("📝 Form Data:", formData);
    }

    // ✅ Validation (only required fields)
    const validation = validateFormData(formData, {
        requiredFields: ["title", "price"],
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
        const result = await StarterPack.createStarterPack({
            title,
            description,
            price,
            enabled,
            mandatory,
            appliesOnTrialConversion,
            appliesOnDirectMembership,
            createdBy: req.admin.id,
        });

        if (!result.status) {
            if (DEBUG) console.log("⚠️ STEP 3: Creation failed:", result.message);

            await logActivity(req, PANEL, MODULE, "create", result, false);

            return res.status(500).json({
                status: false,
                message: result.message || "Failed to create starter pack.",
            });
        }

        if (DEBUG) console.log("✅ STEP 4: Starter pack created:", result.data);

        await logActivity(req, PANEL, MODULE, "create", result, true);

        // ✅ Construct admin full name safely
        const adminFullName =
            req.admin?.name ||
            `${req.admin?.firstName || ""} ${req.admin?.lastName || ""}`.trim() ||
            "Unknown Admin";

        const msg = `Starter pack "${title}" created successfully by ${adminFullName}`;

        await createNotification(req, "Starter Pack Created", msg, "Support");

        return res.status(201).json({
            status: true,
            message: "Starter pack created successfully.",
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

        return res.status(500).json({
            status: false,
            message: "Server error.",
        });
    }
};

// ✅ GET All Starter pack (by admin)
exports.getAllStarterPack = async (req, res) => {
    const adminId = req.admin?.id;
    if (DEBUG)
        console.log(`📦 Getting all starter packs for admin ID: ${adminId}`);

    if (DEBUG) console.log("📥 Fetching all starter pack...");
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    try {
        const result = await StarterPack.getAllStarterPack(superAdminId, adminId); // ✅ filtered by admin

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res.status(500).json({ status: false, message: result.message });
        }

        if (DEBUG) {
            console.log("✅ Starter pack fetched successfully");
            console.table(result.data);
        }

        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            {
                oneLineMessage: `Fetched ${result.data.length || 0} starter pack(s).`,
            },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Fetched starter pack successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error fetching all starter pack:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            { oneLineMessage: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ GET All Starter pack (by admin)
exports.getStarterPackById = async (req, res) => {
    const adminId = req.admin?.id;
    const { id } = req.params;   

    if (DEBUG)
        console.log(`📦 Getting starter pack ID ${id} for admin ID: ${adminId}`);

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    try {
        const result = await StarterPack.getStarterPackById(
            id,
            superAdminId,
            adminId
        );

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "view", result, false);
            return res.status(404).json(result);
        }

        await logActivity(req, PANEL, MODULE, "view", result, true);

        return res.status(200).json({
            status: true,
            message: "Starter pack fetched successfully.",
            data: result.data,
        });

    } catch (error) {
        console.error("❌ Error fetching starter pack:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "view",
            { oneLineMessage: error.message },
            false
        );

        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ UPDATE Starter Pack
exports.updateStarterPack = async (req, res) => {
    const adminId = req.admin?.id;
    const { id } = req.params;
    const formData = req.body;

    if (DEBUG) {
        console.log(`✏️ Updating starter pack ID ${id} by admin ${adminId}`);
        console.log("📝 Form Data:", formData);
    }

    const validation = validateFormData(formData, {
        requiredFields: ["title", "price"],
    });

    if (!validation.isValid) {
        await logActivity(req, PANEL, MODULE, "update", validation.error, false);

        return res.status(400).json({
            status: false,
            error: validation.error,
            message: validation.message,
        });
    }

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    try {
        const result = await StarterPack.updateStarterPack(
            id,
            formData,
            superAdminId,
            adminId
        );

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "update", result, false);
            return res.status(404).json(result);
        }

        await logActivity(req, PANEL, MODULE, "update", result, true);

        await createNotification(
            req,
            "Starter Pack Updated",
            `Starter pack "${formData.title}" updated successfully.`,
            "Support"
        );

        return res.status(200).json({
            status: true,
            message: "Starter pack updated successfully.",
            data: result.data,
        });

    } catch (error) {
        console.error("❌ Error updating starter pack:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "update",
            { oneLineMessage: error.message },
            false
        );

        return res.status(500).json({
            status: false,
            message: "Server error.",
        });
    }
};

// ✅ DELETE Starter Pack (Soft Delete)
exports.deleteStarterPack = async (req, res) => {
    const adminId = req.admin?.id;
    const { id } = req.params;

    if (DEBUG)
        console.log(`🗑️ Deleting starter pack ID ${id} by admin ${adminId}`);

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    try {
        const result = await StarterPack.deleteStarterPack(
            id,
            superAdminId,
            adminId
        );

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "delete", result, false);
            return res.status(404).json(result);
        }

        await logActivity(req, PANEL, MODULE, "delete", result, true);

        await createNotification(
            req,
            "Starter Pack Deleted",
            `Starter pack deleted successfully.`,
            "Support"
        );

        return res.status(200).json({
            status: true,
            message: "Starter pack deleted successfully.",
        });

    } catch (error) {
        console.error("❌ Error deleting starter pack:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            { oneLineMessage: error.message },
            false
        );

        return res.status(500).json({
            status: false,
            message: "Server error.",
        });
    }
};

