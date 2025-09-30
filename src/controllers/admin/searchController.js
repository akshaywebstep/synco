const { getGlobalSearch } = require("../../services/admin/search");
const { logActivity } = require("../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "search";

exports.globalSearch = async (req, res) => {
  try {
    if (!req.admin) {
      console.warn("⚠️ req.admin is undefined");
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Admin not authenticated.",
      });
    }

    const adminId = req.admin.id;
    const { query } = req.query;

    if (DEBUG) {
      console.log("🪵 Logged-in admin:", req.admin);
      console.log("🔍 Search query received:", query);
    }

    const result = await getGlobalSearch(adminId, query);

    if (DEBUG) console.log("📦 Search results:", result);

    if (req.permission) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "view-listing",
        result,
        result.status,
        adminId
      );
      if (DEBUG) console.log("📝 Activity logged for adminId:", adminId);
    } else if (DEBUG) {
      console.log("⚠️ Permission info not attached; skipping activity log");
    }

    return res.status(result.status ? 200 : 400).json(result);
  } catch (error) {
    console.error("❌ Error in globalSearch controller:", error);
    return res.status(500).json({
      status: false,
      message: error?.message || "Something went wrong in global search.",
    });
  }
};
