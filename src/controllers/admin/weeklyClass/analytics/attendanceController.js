const attendanceAnalytics = require("../../../../services/admin/weeklyClass/analytics/attendance");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "weekly-class";

exports.getMonthlyReport = async (req, res) => {
  const adminId = req.admin?.id;

  if (DEBUG) {
    console.log("📊 [Step 1] Request received to generate attendance analytics report.");
    if (Object.keys(req.query).length > 0) {
      console.log("📥 Filters:", JSON.stringify(req.query, null, 2));
    }
  }

  try {
    // ✅ Get main super admin
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? adminId;

    // ✅ Extract filters from query params (e.g., ?filterByVenueName=..., etc.)
    const filters = {
      filterByVenue: req.query.filterByVenue || null,
      filterByClass: req.query.filterByClass || null,
      filterType: req.query.filterType || null,
      bookedBy: req.query.bookedBy || null,
      createdBy: req.query.createdBy || null,
      venueId: req.query.venueId || null,
      classScheduleId: req.query.classScheduleId || null,
    };

    if (DEBUG) {
      console.log("🔍 [Step 2] Generating attendance report for:", {
        adminId,
        superAdminId,
        filters,
      });
    }

    // ✅ Run analytics service
    const analyticsResult = await attendanceAnalytics.getBookingAttendanceAnalytics(
      superAdminId,
      filters,
      adminId
    );

    const successMessage = "Attendance analytics report generated successfully.";
    if (DEBUG) console.log("✅", successMessage);

    // ✅ Log success
    // await logActivity(
    //   req,
    //   PANEL,
    //   MODULE,
    //   "view-attendance-report",
    //   { oneLineMessage: successMessage },
    //   true
    // );

    // ✅ Send clean response
    return res.status(200).json({
      status: true,
      message: successMessage,
      data: analyticsResult.data, // only the structured analytics data
    });
  } catch (error) {
    console.error("❌ Attendance Analytics Report Error:", error);

    // ❌ Log failure
    // await logActivity(
    //   req,
    //   PANEL,
    //   MODULE,
    //   "view-attendance-report",
    //   { oneLineMessage: "Attendance analytics generation failed." },
    //   false
    // );

    return res.status(500).json({
      status: false,
      message:
        "Server error occurred while generating the attendance analytics report. Please try again later.",
    });
  }
};
