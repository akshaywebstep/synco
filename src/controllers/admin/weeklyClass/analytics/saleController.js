// controllers/admin/weeklyClassController.js

const saleTrialAnalytics = require("../../../../services/admin/weeklyClass/analytics/saleTrial");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "weekly-class";

// ✅ Generate Weekly Class Report
exports.getMonthlyReport = async (req, res) => {
  if (DEBUG) {
    console.log(
      "📊 [Step 1] Request received to generate weekly class report."
    );
    if (Object.keys(req.query).length > 0) {
      console.log(
        "📥 Query Filters Received:",
        JSON.stringify(req.query, null, 2)
      );
    }
  }

  // ✅ [Step 2] Get logged-in admin ID
  if (DEBUG) console.log("🔍 Extracting admin ID from request...");

  const adminId = req.admin?.id || null;

  if (!adminId) {
    if (DEBUG) console.log("❌ [Auth Error] Admin ID not found in request.");
    return res.status(401).json({
      status: false,
      message: "Unauthorized: Admin ID not found.",
    });
  }

  if (DEBUG) console.log(`✅ Admin ID detected: ${adminId}`);

  // ✅ [Step 3] Identify super admin
  if (DEBUG) console.log("🔍 Fetching main super admin for admin:", adminId);
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
  const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

  if (DEBUG) {
    if (superAdminId) {
      console.log(`👑 Super Admin detected for this admin: ${superAdminId}`);
    } else {
      console.log("ℹ️ No Super Admin associated with this admin.");
    }
  }

  // ✅ [Step 4] Map filters
  // if (DEBUG) console.log("⚙️ Constructing filters from query params...");
  const filters = {
    adminId,
    superAdminId,
    student: { name: req.query.studentName?.trim() || "" },
    venue: { name: req.query.venueName?.trim() || "" },
    paymentPlan: {
      interval: req.query.paymentPlanInterval?.trim() || "",
      duration: Number(req.query.paymentPlanDuration) || 0,
    },
    admin: { name: req.query.agentName?.trim() || "" },
  };

  // if (DEBUG) {
  //   console.log("✅ Final Filters Object:", JSON.stringify(filters, null, 2));
  // }

  try {
    // ✅ [Step 5] Call report service
    // if (DEBUG)
    //   console.log("📞 Calling saleTrialAnalytics.getMonthlyReport()...");
    const reportResult = await saleTrialAnalytics.getMonthlyReport(filters);

    // if (DEBUG) {
    //   console.log("📊 [Step 6] Service Response Received:");
    //   console.log(JSON.stringify(reportResult, null, 2));
    // }

    // ✅ [Step 7] Handle failed service result
    if (!reportResult.status) {
      const errorMsg =
        reportResult.message || "Failed to generate weekly class report.";

      // if (DEBUG) console.log("❌ [Step 7] Report generation failed:", errorMsg);

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

    // ✅ [Step 8] Success response
    const successMessage = "Weekly class report generated successfully.";
    // if (DEBUG) {
    //   console.log("✅ [Step 8] Report generated successfully.");
    //   console.log("📦 Data Summary:", Object.keys(reportResult.data));
    // }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "view-report",
      { oneLineMessage: successMessage },
      true
    );

    if (DEBUG) console.log("📝 Activity logged successfully.");

    return res.status(200).json({
      status: true,
      message: successMessage,
      data: reportResult.data,
    });
  } catch (error) {
    // ✅ [Step 9] Error handling
    console.error("❌ [Step 9] Weekly Class Report Error:", error);

    if (DEBUG && error?.stack) {
      console.error("🧾 Error Stack Trace:\n", error.stack);
    }

    return res.status(500).json({
      status: false,
      message:
        "Server error occurred while generating the weekly class report. Please try again later.",
    });
  }
};
