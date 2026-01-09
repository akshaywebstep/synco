const { logActivity } = require("../../../../utils/admin/activityLogger");
const {
  getAllHolidayVenuesWithHolidayClasses,
  getHolidayClassById,
  // getAllTermsForListing,
} = require("../../../../services/admin/holidayCamps/findClass/findAClass");

const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "find-class";

exports.findAHolidayClassListing = async (req, res) => {
  try {
    const adminId = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    if (!superAdminId) {
      return res.status(403).json({ status: false, message: "No valid super admin found for this request." });
    }

    const { lat, lng, range } = req.query;

    // Safely parse coordinates and range
    const DEFAULT_LAT = -27.4756; // default reference point
    const DEFAULT_LNG = 153.02;

    const userLatitude = lat ? parseFloat(lat) : DEFAULT_LAT;
    const userLongitude = lng ? parseFloat(lng) : DEFAULT_LNG;
    // const userLatitude = lat ? parseFloat(lat) : null;
    // const userLongitude = lng ? parseFloat(lng) : null;
    const searchRadiusMiles = range ? parseFloat(range) : null;

    if (DEBUG) {
      console.log("📥 Fetching venue listings with classes");
      console.log("➡ Filters:", { userLatitude, userLongitude, searchRadiusMiles, createdBy: superAdminId });
    }

    const result = await getAllHolidayVenuesWithHolidayClasses({
      userLatitude,
      userLongitude,
      searchRadiusMiles,
      createdBy: superAdminId,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json(result);
    }

    await logActivity(req, PANEL, MODULE, "list", { message: "Fetched class listings" }, true);

    return res.status(200).json({
      status: true,
      message: "Class listings fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ findAClassListing Error:", error);
    await logActivity(req, PANEL, MODULE, "list", { oneLineMessage: error.message }, false);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.getHolidayClassScheduleById = async (req, res) => {
  const { id } = req.params;
  const createdBy = req.admin?.id;
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  if (DEBUG) console.log(`🔍 Fetching class + venue for class ID: ${id}`);

  try {
    // ✅ Call service with only classId (no adminId)
    const result = await getHolidayClassById(id, superAdminId);

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Not found:", result.message);
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) console.log("✅ Data fetched:", result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "getById",
      { oneLineMessage: `Fetched class schedule with ID: ${id}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Class and venue fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching class schedule:", error);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};