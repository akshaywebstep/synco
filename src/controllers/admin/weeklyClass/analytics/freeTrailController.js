// controllers/admin/weeklyClassController.js

const freeTrailAnalytics = require("../../../../services/admin/weeklyClass/analytics/freeTrail");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "weekly-class";

// ✅ Generate Weekly Class Report
exports.getMonthlyReport = async (req, res) => {
  if (DEBUG) {
    console.log("📊 [Step 1] Request received to generate weekly class report.");
    if (Object.keys(req.query).length > 0) {
      console.log("📥 Filters:", JSON.stringify(req.query, null, 2));
    }
  }

  // ✅ Map query parameters into structured filters
  const filters = {
    student: { name: req.query.studentName?.trim() || '' },
    venue: { name: req.query.venueName?.trim() || '' },
    paymentPlan: {
      interval: req.query.paymentPlanInterval?.trim() || '',
      duration: Number(req.query.paymentPlanDuration) || 0,
    },
    admin: { name: req.query.agentName?.trim() || '' },
  };

  if (DEBUG) {
    console.log("🔧 Final Filters Object:", JSON.stringify(filters, null, 2));
  }

  try {
    // Pass filters (if any) from query params to service
    const reportResult = await freeTrailAnalytics.getMonthlyReport(filters);

    if (!reportResult.status) {
      const errorMsg =
        reportResult.message || "Failed to generate weekly class report.";

      if (DEBUG) console.log("❌ Report generation failed:", errorMsg);

      await logActivity(
        req,
        PANEL,
        MODULE,
        "view-report",
        { oneLineMessage: errorMsg },
        false
      );

      return res.status(500).json({
        status: false,
        message: errorMsg,
      });
    }

    const successMessage = "Weekly class report generated successfully.";

    if (DEBUG) {
      console.log("✅", successMessage);
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "view-report",
      { oneLineMessage: successMessage },
      true
    );

    return res.status(200).json({
      status: true,
      message: successMessage,
      data: reportResult.data,
    });
  } catch (error) {
    console.error("❌ Weekly Class Report Error:", error);

    return res.status(500).json({
      status: false,
      message:
        "Server error occurred while generating the weekly class report. Please try again later.",
    });
  }
};
