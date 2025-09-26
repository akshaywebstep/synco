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
    const { lat, lng, range } = req.query;

    // Safely parse coordinates and range
    const userLatitude = lat ? parseFloat(lat) : null;
    const userLongitude = lng ? parseFloat(lng) : null;
    const searchRadiusMiles = range ? parseFloat(range) : null;

    if (DEBUG) {
      console.log("📥 Fetching venue listings with classes");
      console.log("➡ Filters:", {
        userLatitude,
        userLongitude,
        searchRadiusMiles,
      });
    }

    const result = await getAllVenuesWithClasses({
      userLatitude,
      userLongitude,
      searchRadiusMiles,
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

exports.getAllClassSchedules = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all class schedules...");

  try {
    const result = await ClassScheduleService.getAllClasses();

    if (!result.status) {
      if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
      await logActivity(req, PANEL, MODULE, "list", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    if (DEBUG) console.table(result.data);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { oneLineMessage: `Fetched ${result.data.length} class schedules.` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Fetched class schedules successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching all class schedules:", error);
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

exports.getClassScheduleById = async (req, res) => {
  const { id } = req.params;
  if (DEBUG) console.log(`🔍 Fetching class + venue for class ID: ${id}`);

  try {
    // ✅ Call service with only classId (no adminId)
    const result = await getClassById(id);

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

// ✅ SINGLE VENUE CONTROLLER
// exports.findAClassByVenue = async (req, res) => {
//   const { venueId } = req.params;
//   const { onlyAvailable } = req.query;
//   const parsedOnlyAvailable = parseBoolean(onlyAvailable);

//   if (DEBUG) {
//     console.log("📥 Fetching SINGLE venue listing", {
//       venueId,
//       onlyAvailable: parsedOnlyAvailable,
//     });
//   }

//   try {
//     const result = await getVenueWithClassesById(venueId, parsedOnlyAvailable);

//     if (!result.status) {
//       await logActivity(req, PANEL, MODULE, "list", result, false);
//       return res.status(404).json(result);
//     }

//     return res.status(200).json({
//       status: true,
//       message: `Class listing fetched for venue ID ${venueId}`,
//       data: result.data, // ✅ SINGLE VENUE as an object, not array
//     });
//   } catch (error) {
//     console.error("❌ findAClassByVenue Error:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "list",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.listTerms = async (req, res) => {
//   if (DEBUG) console.log("📥 Fetching Terms → SessionPlanGroups");

//   try {
//     const result = await getAllTermsForListing();

//     if (!result.status) {
//       await logActivity(req, PANEL, MODULE, "list", result, false);
//       return res.status(500).json(result);
//     }

//     return res.status(200).json({
//       status: true,
//       message: "Terms fetched successfully.",
//       data: result.data, // ✅ flat array of terms
//     });
//   } catch (error) {
//     console.error("❌ listTerms Error:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "list",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error" });
//   }
// };
