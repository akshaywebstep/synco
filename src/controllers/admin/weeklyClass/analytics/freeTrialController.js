// controllers/admin/weeklyClassController.js

const freeTrialAnalytics = require("../../../../services/admin/weeklyClass/analytics/freeTrial");
const { logActivity } = require("../../../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "weekly-class";
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

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
    dashboardFilters: {
      venueId: req.query.venueId ? Number(req.query.venueId) : null,
      classScheduleId: req.query.classScheduleId
        ? Number(req.query.classScheduleId)
        : null,
      period: req.query.period || "",
    },
  };

  if (DEBUG) {
    console.log("🔧 Final Filters Object:", JSON.stringify(filters, null, 2));
  }

  try {
    // -------------------------
    // Resolve role-based bookedBy filter
    // -------------------------
    const role = req.admin?.role?.toLowerCase();

    // Get main super admin + children
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id, true);

    if (!req.query.bookedBy) {
      if (role === "super admin") {
        const childAdminIds = (mainSuperAdminResult?.admins || []).map(a => a.id);

        filters.bookedBy = {
          type: "super_admin",
          adminIds: [req.admin.id, ...childAdminIds],
        };
      } else if (role === "admin") {
        filters.bookedBy = {
          type: "admin",
          adminIds: [
            req.admin.id,
            mainSuperAdminResult?.superAdmin?.id,
          ].filter(Boolean),
        };
      } else {
        filters.bookedBy = {
          type: "agent",
          adminIds: [req.admin.id],
        };
      }
    } else {
      // If bookedBy explicitly sent in query (optional)
      const bookedByQuery = req.query.bookedBy;
      if (Array.isArray(bookedByQuery)) {
        filters.bookedBy = bookedByQuery.map(Number).filter(Boolean);
      } else {
        filters.bookedBy = bookedByQuery.split(",").map(Number).filter(Boolean);
      }
    }

    if (DEBUG) {
      console.log("🔧 Final Filters Object:", JSON.stringify(filters, null, 2));
    }
    // Pass filters (if any) from query params to service
    const reportResult = await freeTrialAnalytics.getMonthlyReport(filters);

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
