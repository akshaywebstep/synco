const  KeyInformationService  = require("../../../services/admin/booking/keyInformation");
const { logActivity } = require("../../../utils/admin/activityLogger");
const { createNotification } = require("../../../utils/admin/notificationHelper");

const PANEL = "admin";
const MODULE = "key-information";

exports.updateKeyInformation = async (req, res) => {
  const { keyInformation } = req.body;

  try {
    const result = await KeyInformationService.updateKeyInformation(keyInformation);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update", result, false);
      return res.status(500).json(result);
    }

    await logActivity(req, PANEL, MODULE, "update", result, true);
    await createNotification(
      req,
      "Key Information Updated",
      `Key Information was updated by ${req.admin?.firstName || "Admin"}.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ updateKeyInformation error:", error);
    await logActivity(req, PANEL, MODULE, "update", { oneLineMessage: error.message }, false);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// Get all KeyInformation
exports.getAllKeyInformation = async (req, res) => {
  try {
    const record = await KeyInformationService.getAllKeyInformation();

    if (!record.status) {
      await logActivity(req, PANEL, MODULE, "list", record, false);
      return res.status(500).json(record);
    }

    await logActivity(req, PANEL, MODULE, "list", {
      oneLineMessage: `Fetched key information successfully`,
    }, true);

    return res.status(200).json({
      status: true,
      message: "KeyInformation fetched successfully",
      data: record.data,
    });
  } catch (error) {
    console.error("❌ getAllKeyInformation error:", error);
    await logActivity(req, PANEL, MODULE, "list", { oneLineMessage: error.message }, false);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};
