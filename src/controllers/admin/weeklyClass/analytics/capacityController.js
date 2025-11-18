// controllers/admin/weeklyClass/analytics/capacityController.js

const capacityAnalytics = require("../../../../services/admin/weeklyClass/analytics/capacity");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "weekly-class";

exports.getMonthlyReport = async (req, res) => {
    const adminId = req.admin?.id;

    if (DEBUG) {
        console.log("📊 [Step 1] Request received to generate capacity analytics report.");
        if (Object.keys(req.query).length > 0) {
            console.log("📥 Filters:", JSON.stringify(req.query, null, 2));
        }
    }

    try {
        // ✅ Get super admin of this admin
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? adminId;

        // ✅ Extract filters from query (e.g., age, period)
        const filters = req.query || {};

        // --- Generate all reports ---
        const reportResult = await capacityAnalytics.getCapacityWidgets(superAdminId, filters, adminId);
        const monthWiseResult = await capacityAnalytics.getCapacityMonthWise(superAdminId, filters, adminId);
        const highDemandVenue = await capacityAnalytics.getHighDemandVenue(superAdminId, filters, adminId);
        const capacityByVenue = await capacityAnalytics.getCapacityByVenue(superAdminId, filters, adminId);
        const capacityByClass = await capacityAnalytics.capacityByClass(superAdminId, filters, adminId);
        const membershipPlans = await capacityAnalytics.membershipPlans(superAdminId, filters, adminId);

        // ✅ Get venues created by this admin/super-admin
        const venuesByAdmin = await capacityAnalytics.getVenuesByAdmin(superAdminId, adminId);

        const successMessage = "Capacity analytics report generated successfully.";
        if (DEBUG) console.log("✅", successMessage);

        // ✅ Log successful report view
        await logActivity(
            req,
            PANEL,
            MODULE,
            "view-capacity-report",
            { oneLineMessage: successMessage },
            true
        );

        // ✅ Return combined response
        return res.status(200).json({
            status: true,
            message: successMessage,
            data: {
                summary: reportResult,
                charts: monthWiseResult,
                highDemandVenue,
                capacityByVenue,
                membershipPlans,
                capacityByClass,
                venuesByAdmin, // <-- called correctly
            },
        });
    } catch (error) {
        console.error("❌ Capacity Analytics Report Error:", error);

        // ❌ Log failure
        await logActivity(
            req,
            PANEL,
            MODULE,
            "view-capacity-report",
            { oneLineMessage: "Capacity analytics generation failed." },
            false
        );

        return res.status(500).json({
            status: false,
            message:
                "Server error occurred while generating the capacity analytics report. Please try again later.",
        });
    }
};
