const { logActivity } = require("../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../utils/auth");
const {
  getDashboardStats,
  getWidgetsByAdmin,
  updateWidgetsOrderAndVisibility,
} = require("../../services/admin/dashboard");
const moment = require("moment");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "dashboard";

// 📊 Get overall dashboard statistics
exports.dashboardStats = async (req, res) => {
  try {
    const adminId = req.admin?.id;

    // 🔹 Get Super Admin ID
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    if (!adminId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin not authenticated.",
      });
    }

    let { filterType, fromDate, toDate } = req.query;

    // Normalize filterType: if multiple are passed, take only the first one
    if (Array.isArray(filterType)) {
      filterType = filterType[0];
    }

    // If user sends custom dates, ignore filterType
    if (fromDate && toDate) {
      filterType = null; // disable default filter
    } else {
      filterType = filterType || "";
    }

    const parsedFromDate = fromDate ? new Date(fromDate) : null;
    const parsedToDate = toDate ? new Date(toDate) : null;

    const result = await getDashboardStats(
      superAdminId,
      adminId,
      filterType,
      parsedFromDate,
      parsedToDate
    );

    return res.status(result.status ? 200 : 400).json(result);
  } catch (error) {
    console.error("❌ Error in dashboardStats controller:", error);
    return res.status(500).json({
      status: false,
      message: error?.message || "Something went wrong in dashboard stats.",
    });
  }
};

// 🧩 Get all dashboard widgets
exports.getDashboardWidgets = async (req, res) => {
  if (DEBUG) console.log("🧩 [DEBUG] getDashboardWidgets called");

  const adminId = req.admin?.id; // ✅ get the admin id from request
  if (!adminId) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized: Admin not authenticated.",
    });
  }

  const result = await getWidgetsByAdmin(adminId); // ✅ pass adminId

  if (DEBUG) console.log("📦 Fetched Widgets:", result);

  await logActivity(
    req,
    PANEL,
    MODULE,
    "view_dashboard_widgets",
    result,
    result.status
  );

  return res.status(result.status ? 200 : 500).json(result);
};

exports.updateDashboardWidgets = async (req, res) => {
  try {
    console.log("📩 Incoming request to updateDashboardWidgets");
    console.log("🔑 Admin from req.admin:", req.admin);
    console.log("📦 Raw req.body (before fix):", req.body);

    const adminId = req.admin?.id;
    let widgets = null;

    // Case 1: Already parsed array
    if (Array.isArray(req.body)) {
      widgets = req.body;
    }

    // Case 2: { widgets: [...] }
    else if (req.body?.widgets) {
      widgets = req.body.widgets;
    }

    // Case 3: body-parser failed → req.body is empty → parse raw stream
    if (!widgets) {
      let rawData = "";
      await new Promise((resolve) => {
        req.on("data", (chunk) => (rawData += chunk));
        req.on("end", resolve);
      });

      if (rawData) {
        try {
          const parsed = JSON.parse(rawData);
          widgets = Array.isArray(parsed) ? parsed : parsed.widgets;
          console.log("📦 Parsed from raw stream:", widgets);
        } catch (err) {
          console.error("❌ Failed to parse raw body:", rawData);
        }
      }
    }

    console.log("🧩 Final widgets:", widgets);

    if (!Array.isArray(widgets) || widgets.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid request: 'widgets' must be a non-empty array.",
      });
    }

    // 🔄 Update DB
    const result = await updateWidgetsOrderAndVisibility(adminId, widgets);

    if (!result.status) {
      return res.status(500).json(result);
    }

    // 📝 Log activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update_dashboard_widgets",
      {
        oneLineMessage: `Updated ${widgets.length} dashboard widgets`,
      },
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Error in updateDashboardWidgets:", error);
    return res.status(500).json({
      status: false,
      message: error?.message || "Something went wrong while updating widgets.",
    });
  }
};
