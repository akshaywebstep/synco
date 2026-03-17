const { logActivity } = require("../../../utils/admin/activityLogger");
const {
  getAllVenuesWithClasses,
  getClassById,
  // getAllTermsForListing,
} = require("../../../services/admin/findClass/listingAllVenuesAndClasses");

const ClassScheduleService = require("../../../services/admin/findClass/listingAllVenuesAndClasses");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "find-class";


exports.findAClassListing = async (req, res) => {
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

    // if (DEBUG) {
    //   console.log("📥 Fetching venue listings with classes");
    //   console.log("➡ Filters:", { userLatitude, userLongitude, searchRadiusMiles, adminId, superAdminId });
    // }

    const result = await getAllVenuesWithClasses({
      userLatitude,
      userLongitude,
      searchRadiusMiles,
      // createdBy: superAdminId,
      adminId,
      superAdminId,
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

// ✅ ALL VENUES CONTROLLER
// exports.findAClassListing = async (req, res) => {
//   const adminId = req.admin?.id;
//   const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
//   const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

//   if (!superAdminId) {
//     return res.status(400).json({
//       status: false,
//       message: "Super admin not found for this account.",
//     });
//   }
//   try {

//     const { lat, lng, range } = req.query;

//     // Safely parse coordinates and range
//     const userLatitude = lat ? parseFloat(lat) : null;
//     const userLongitude = lng ? parseFloat(lng) : null;
//     const searchRadiusMiles = range ? parseFloat(range) : null;
//     onsole.log("📥 Fetching venues with classes for superAdminId:", superAdminId);

//     if (DEBUG) {
//       console.log("📥 Fetching venue listings with classes");
//       console.log("➡ Filters:", {
//         userLatitude,
//         userLongitude,
//         searchRadiusMiles,
//       });
//     }

//     const result = await getAllVenuesWithClasses({
//       userLatitude,
//       userLongitude,
//       searchRadiusMiles,
//       superAdminId
//     });

//     if (!result.status) {
//       await logActivity(req, PANEL, MODULE, "list", result, false);
//       return res.status(500).json(result);
//     }

//     return res.status(200).json({
//       status: true,
//       message: "Class listings fetched successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ findAClassListing Error:", error);
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

// exports.getAllClassSchedules = async (req, res) => {
//   if (DEBUG) console.log("📥 Fetching all class schedules...");

//   try {
//     const result = await ClassScheduleService.getAllClasses();

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
//       await logActivity(req, PANEL, MODULE, "list", result, false);
//       return res.status(500).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.table(result.data);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "list",
//       { oneLineMessage: `Fetched ${result.data.length} class schedules.` },
//       true
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Fetched class schedules successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching all class schedules:", error);
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

exports.getAllClassSchedules = async (req, res) => {
  if (DEBUG) console.log("📥 Fetching all class schedules...");

  try {
    const createdBy = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    if (DEBUG) {
      console.log("➡ Super admin check:", {
        adminId: req.admin?.id,
        superAdminId,
      });
    }

    if (!superAdminId || isNaN(Number(superAdminId))) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "list",
        { oneLineMessage: "No valid super admin found for this request." },
        false
      );
      return res.status(400).json({
        status: false,
        message: "No valid super admin found for this request.",
      });
    }

    // ✅ Pass the superAdminId (top-level creator) to service
    const result = await ClassScheduleService.getAllClasses(superAdminId);

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
  // const createdBy = req.admin?.id;
  const adminId = req.admin?.id;
  const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
  const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
  if (DEBUG) console.log(`🔍 Fetching class + venue for class ID: ${id}`);

  try {
    // ✅ Call service with only classId (no adminId)
    const result = await getClassById(id,adminId, superAdminId);

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
