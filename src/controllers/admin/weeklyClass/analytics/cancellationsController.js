const cancellationsAnalytics = require("../../../../services/admin/weeklyClass/analytics/cancellations");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "weekly-class";

// 🎯 Controller: Get Cancellations Analytics Report
exports.getCancellationsReport = async (req, res) => {
    const adminId = req.admin?.id;
     const filters = req.query || {}; 

    if (DEBUG) {
        console.log("📊 [Step 1] Request received to generate cancellations analytics report.");
        if (Object.keys(req.query).length > 0) {
            console.log("📥 Filters:", JSON.stringify(req.query, null, 2));
        }
    }

    try {
        // ✅ Get the main super admin of this admin
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? adminId;

        // 🎯 Extract optional filters

        // ✅ Generate all cancellations-related analytics
        const analyticsData = await cancellationsAnalytics.getWeeklyClassPerformance(
            superAdminId,
            adminId,
            filters
        );

        const successMessage = "Cancellations analytics report generated successfully.";
        if (DEBUG) console.log("✅", successMessage);

        // ✅ Log successful report access
        // await logActivity(
        //     req,
        //     PANEL,
        //     MODULE,
        //     "view-cancellations-report",
        //     { oneLineMessage: successMessage },
        //     true
        // );

        // ✅ Send success response
        return res.status(200).json({
            status: true,
            message: successMessage,
            data: analyticsData,
        });
    } catch (error) {
        console.error("❌ Cancellations Analytics Report Error:", error);

        // ❌ Log failure
        // await logActivity(
        //     req,
        //     PANEL,
        //     MODULE,
        //     "view-cancellations-report",
        //     { oneLineMessage: "Cancellations analytics generation failed." },
        //     false
        // );

        return res.status(500).json({
            status: false,
            message:
                "Server error occurred while generating the cancellations analytics report. Please try again later.",
        });
    }
};
