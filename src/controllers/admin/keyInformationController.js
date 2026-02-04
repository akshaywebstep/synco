const  KeyInformationService  = require("../../services/admin/keyInformation");
const { logActivity } = require("../../utils/admin/activityLogger");
const { createNotification } = require("../../utils/admin/notificationHelper");

const PANEL = "admin";
const MODULE = "key-information";

exports.updateKeyInformation = async (req, res) => {
  const { serviceType, keyInformation } = req.body;

  try {
    const result = await KeyInformationService.updateKeyInformation({
      serviceType,
      keyInformation,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "update", result, false);
      return res.status(400).json(result);
    }

    await logActivity(req, PANEL, MODULE, "update", result, true);

    await createNotification(
      req,
      "Key Information Updated",
      `Key Information for ${serviceType} was updated by ${
        req.admin?.firstName || "Admin"
      }.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ updateKeyInformation error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ GET ALL
exports.getAllKeyInformation = async (req, res) => {
  try {
    const result = await KeyInformationService.getAllKeyInformation();

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "view", result, false);
      return res.status(500).json(result);
    }

    await logActivity(req, PANEL, MODULE, "view", result, true);

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getAllKeyInformation error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "view",
      { oneLineMessage: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ GET by serviceType (Booking screen)
exports.getKeyInformationByServiceType = async (req, res) => {
  const { serviceType } = req.params; // OR req.query

  try {
    const result =
      await KeyInformationService.getKeyInformationByServiceType(serviceType);

    if (!result.status) {
      return res.status(400).json(result);
    }

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getKeyInformationByServiceType error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error.",
    });
  }
};