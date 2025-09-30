const stateModel = require("../../services/location/state");
const cityModel = require("../../services/location/city");
const { logActivity } = require("../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === 'true';

const PANEL = 'admin';
const MODULE = 'location-state';

// ✅ Get All States
exports.getAllStates = async (req, res) => {
  const adminId = req.admin?.id;

  if (DEBUG) {
    console.log(`🟢 [START] Admin ${adminId} requested all states`);
  }

  try {
    // ✅ Step 1: Fetch data
    const result = await stateModel.getAllStates();

    // ❌ Failed response from service
    if (!result.status) {
      const failMessage = result.message || "Failed to fetch states.";
      console.error(`❌ [FAIL] Fetch states:`, failMessage);

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
    const errorMsg = error?.message || "Unhandled error while fetching states.";
    console.error(`❌ [ERROR] Exception in getAllStates:`, errorMsg);

    await logActivity(req, PANEL, MODULE, 'list', { oneLineMessage: errorMsg }, false);

    return res.status(500).json({
      status: false,
      message: "Server error occurred while fetching states. Please try again later."
    });
  }
};

// ✅ Get All Cities of a Specific State
exports.getAllCitiesOfState = async (req, res) => {
  const stateId = req.params.stateId;

  if (DEBUG) {
    console.log(`🟢 [START] requested cities for stateId: ${stateId}`);
  }

  // ✅ Step 1: Validate stateId
  if (!stateId || isNaN(stateId)) {
    const invalidMsg = "Invalid or missing state ID.";
    console.error(`❌ [INVALID]`, invalidMsg);

    await logActivity(req, PANEL, MODULE, 'cities-list', { oneLineMessage: invalidMsg }, false);

    return res.status(400).json({
      status: false,
      message: invalidMsg
    });
  }

  try {
    // ✅ Step 2: Fetch cities
    const result = await cityModel.getCitiesByStateId(stateId);

    if (!result.status) {
      const failMessage = result.message || "Failed to fetch cities.";
      console.error(`❌ [FAIL] Fetch cities:`, failMessage);

      await logActivity(req, PANEL, MODULE, 'cities-list', { oneLineMessage: failMessage }, false);

      return res.status(500).json({
        status: false,
        message: failMessage
      });
    }

    if (DEBUG) {
      console.log(`✅ [SUCCESS] ${result.message}`);
      console.log(`📦 Data sample:`, result.data?.[0] || '(empty)');
    }

    await logActivity(req, PANEL, MODULE, 'cities-list', {
      oneLineMessage: result.message,
      totalCount: result.data?.length
    }, true);

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    const errorMsg = error?.message || "Unhandled error while fetching cities.";
    console.error(`❌ [ERROR] Exception in getAllCitiesOfState:`, errorMsg);

    await logActivity(req, PANEL, MODULE, 'cities-list', { oneLineMessage: errorMsg }, false);

    return res.status(500).json({
      status: false,
      message: "Server error occurred while fetching cities. Please try again later."
    });
  }
};