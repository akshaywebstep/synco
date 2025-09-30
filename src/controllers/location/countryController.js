const countryModel = require("../../services/location/country");
const stateModel = require("../../services/location/state");
const { logActivity } = require("../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === 'true';

const PANEL = 'admin';
const MODULE = 'location-country';

// ✅ Get All Countries
exports.getAllCountries = async (req, res) => {
  const adminId = req.admin?.id;

  if (DEBUG) {
    console.log(`🟢 [START] Admin ${adminId} requested all countries`);
  }

  try {
    // ✅ Step 1: Fetch data
    const result = await countryModel.getAllCountries();

    // ❌ Failed response from service
    if (!result.status) {
      const failMessage = result.message || "Failed to fetch countries.";
      console.error(`❌ [FAIL] Fetch countries:`, failMessage);

      await logActivity(req, PANEL, MODULE, 'list', { oneLineMessage: failMessage }, false);

      return res.status(500).json({
        status: false,
        message: failMessage
      });
    }

    if (DEBUG) {
      console.log(`✅ [SUCCESS] ${result.message}`);
      console.log(`📦 Data sample:`, result.data?.[0] || '(empty)');
    }

    await logActivity(req, PANEL, MODULE, 'list', {
      oneLineMessage: result.message,
      totalCount: result.data?.length
    }, true);

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    const errorMsg = error?.message || "Unhandled error while fetching countries.";
    console.error(`❌ [ERROR] Exception in getAllCountries:`, errorMsg);

    await logActivity(req, PANEL, MODULE, 'list', { oneLineMessage: errorMsg }, false);

    return res.status(500).json({
      status: false,
      message: "Server error occurred while fetching countries. Please try again later."
    });
  }
};

// ✅ Get All States of a Specific Country
exports.getAllStatesOfCountry = async (req, res) => {
  const countryId = req.params.countryId;

  if (DEBUG) {
    console.log(`🟢 [START] requested states for countryId: ${countryId}`);
  }

  // Validate input
  if (!countryId || isNaN(countryId)) {
    const invalidMsg = "Invalid or missing country ID.";
    console.error(`❌ [INVALID]`, invalidMsg);

    await logActivity(req, PANEL, MODULE, 'states-list', { oneLineMessage: invalidMsg }, false);

    return res.status(400).json({
      status: false,
      message: invalidMsg
    });
  }

  try {
    const result = await stateModel.getStatesByCountryId(countryId);

    if (!result.status) {
      const failMessage = result.message || "Failed to fetch states.";
      console.error(`❌ [FAIL] Fetch states:`, failMessage);

      await logActivity(req, PANEL, MODULE, 'states-list', { oneLineMessage: failMessage }, false);

      return res.status(500).json({
        status: false,
        message: failMessage
      });
    }

    if (DEBUG) {
      console.log(`✅ [SUCCESS] ${result.message}`);
      console.log(`📦 Data sample:`, result.data?.[0] || '(empty)');
    }

    await logActivity(req, PANEL, MODULE, 'states-list', {
      oneLineMessage: result.message,
      totalCount: result.data?.length
    }, true);

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    const errorMsg = error?.message || "Unhandled error while fetching states.";
    console.error(`❌ [ERROR] Exception in getAllStatesOfCountry:`, errorMsg);

    await logActivity(req, PANEL, MODULE, 'states-list', { oneLineMessage: errorMsg }, false);

    return res.status(500).json({
      status: false,
      message: "Server error occurred while fetching states. Please try again later."
    });
  }
};

// ✅ Get a specific country by ID
exports.getCountryById = async (req, res) => {
  const { countryId } = req.params;

  if (DEBUG) console.log(`🟢 [START] Get country by ID: ${countryId}`);

  // Input validation
  if (!countryId || isNaN(countryId)) {
    const msg = "Invalid country ID.";
    await logActivity(req, PANEL, MODULE, 'getById', { oneLineMessage: msg }, false);
    return res.status(400).json({ status: false, message: msg });
  }

  try {
    const result = await countryModel.getCountryById(countryId);

    if (!result.status) {
      const failMsg = result.message || "Country not found.";
      await logActivity(req, PANEL, MODULE, 'getById', { oneLineMessage: failMsg }, false);
      return res.status(404).json({ status: false, message: failMsg });
    }

    await logActivity(req, PANEL, MODULE, 'getById', {
      oneLineMessage: `Fetched country ID: ${countryId}`
    }, true);

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    const errorMsg = error?.message || "Error fetching country.";
    console.error("❌ [ERROR] getCountryById:", errorMsg);

    await logActivity(req, PANEL, MODULE, 'getById', { oneLineMessage: errorMsg }, false);
    return res.status(500).json({
      status: false,
      message: "Server error occurred while fetching country."
    });
  }
};