const { logActivity } = require("../../../../utils/admin/activityLogger");
const {
  getAllVenuesWithClasses,
  getClassById,
  // getAllTermsForListing,
} = require("../../../../services/admin/open/findClass/listingAllVenuesAndClasses");

const axios = require("axios");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "website";
const MODULE = "find-class";

async function getCoordinatesFrompostal_code(postal_code) {
  if (
    !postal_code ||
    typeof postal_code !== "string" ||
    postal_code.trim().length < 3
  ) {
    console.warn("⚠️ Invalid postal_code:", postal_code);
    return null;
  }

  const cleanedpostal_code = postal_code.trim().replace(/\s+/g, ""); // remove spaces
  const username = "akshaywebstep"; // your GeoNames username

  try {
    const res = await axios.get(
      "http://api.geonames.org/postalCodeSearchJSON",
      {
        params: {
          postalcode: cleanedpostal_code,
          maxRows: 1,
          username,
        },
        timeout: 10000,
      }
    );

    if (res.data?.postalCodes?.length > 0) {
      const place = res.data.postalCodes[0];

      return {
        latitude: parseFloat(place.lat),
        longitude: parseFloat(place.lng),
        city: place.placeName || null,
        state: place.adminName1 || null,
        country: place.countryCode || null,
        raw: place,
      };
    }
  } catch (err) {
    console.error("❌ GeoNames API error:", err.message);
  }

  console.warn("⚠️ No coordinates found for:", postal_code);
  return null;
}

exports.findAClassListing = async (req, res) => {
  try {
    const { lat, lng, range, postal_code, venueName } = req.query;

    const DEFAULT_LAT = -27.4756;
    const DEFAULT_LNG = 153.02;

    // 🔧 MUST be let (they get overridden)
    let userLatitude = lat ? parseFloat(lat) : DEFAULT_LAT;
    let userLongitude = lng ? parseFloat(lng) : DEFAULT_LNG;

    const searchRadiusMiles = range ? parseFloat(range) : null;

    if (DEBUG) {
      console.log("📥 Fetching venue listings with classes");
      console.log("➡ Filters:", {
        userLatitude,
        userLongitude,
        searchRadiusMiles,
        postal_code,
        venueName,
      });
    }

    // ✅ Override coords using postal code
    if (postal_code) {
      const postal_codeCoords = await getCoordinatesFrompostal_code(
        postal_code
      );

      if (postal_codeCoords) {
        userLatitude = postal_codeCoords.latitude;
        userLongitude = postal_codeCoords.longitude;
      }
    }

    const result = await getAllVenuesWithClasses({
      userLatitude,
      userLongitude,
      searchRadiusMiles,
      venueName,
      postal_code,
    });

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
    return res.status(500).json({
      status: false,
      message: "Server error.",
    });
  }
};

exports.getClassScheduleById = async (req, res) => {
  const { id } = req.params;
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
