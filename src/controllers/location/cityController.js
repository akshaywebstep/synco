const cityModel = require("../../services/location/city");
const { logActivity } = require("../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === 'true';

const PANEL = 'admin';
const MODULE = 'location-city';

// ✅ Get All Cities
exports.getAllCities = async (req, res) => {
  const adminId = req.admin?.id;

  if (DEBUG) {
    console.log(`🟢 [START] Admin ${adminId} requested all cities`);
  }

  try {
    // ✅ Step 1: Fetch data
    const result = await cityModel.getAllCities();

    // ❌ Failed response from service
    if (!result.status) {
      const failMessage = result.message || "Failed to fetch cities.";
      console.error(`❌ [FAIL] Fetch cities:`, failMessage);

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
    const errorMsg = error?.message || "Unhandled error while fetching cities.";
    console.error(`❌ [ERROR] Exception in getAllCities:`, errorMsg);

    await logActivity(req, PANEL, MODULE, 'list', { oneLineMessage: errorMsg }, false);

    return res.status(500).json({
      status: false,
      message: "Server error occurred while fetching cities. Please try again later."
    });
  }
};
