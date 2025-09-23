const { logActivity } = require("../../../utils/admin/activityLogger");
const {
  getAllVenuesWithClasses,
  getClassById,
  // getAllTermsForListing,
} = require("../../../services/admin/findClass/listingAllVenuesAndClasses");

const ClassScheduleService = require("../../../services/admin/findClass/listingAllVenuesAndClasses");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "find-class";

// ✅ Safe boolean parsing
const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
};

// ✅ ALL VENUES CONTROLLER
exports.findAClassListing = async (req, res) => {
  try {
    const { lat, lng, day, onlyAvailable, search } = req.query;

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    const parsedOnlyAvailable =
      onlyAvailable === "true" || onlyAvailable === true;

    if (DEBUG) {
      console.log("📥 Fetching ALL venue listings");
      console.log("➡ Filters:", {
        day,
        onlyAvailable: parsedOnlyAvailable,
        userLat,
        userLng,
        search,
      });
    }

    const result = await getAllVenuesWithClasses({
      userLat,
      userLng,
      day,
      onlyAvailable: parsedOnlyAvailable,
      search,
      userId: req.admin?.id, // ✅ Corrected here
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json(result);
    }

    return res.status(200).json({
      status: true,
      message: "Class listings fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ findAClassListing Error:", error);
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
