const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const RebookingService = require("../../../services/admin/booking/reebookingFreeTrial"); // updated service
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "rebooking_trial";

// ✅ Create or update a booking with rebooking info
exports.createRebookingTrial = async (req, res) => {
   console.log("📍 createRebookingTrial reached");
  const payload = req.body;

  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["bookingId", "reasonForNonAttendance"],
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "create", error, false);
    return res.status(400).json({ status: false, ...error });
  }

  try {
    const result = await RebookingService.createRebooking({
      ...payload,
      createdBy: req?.admin?.id,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    const notifyMsg = `Trial rebooked for booking ID ${payload.bookingId}`;
    await createNotification(req, "Trial Rebooked", notifyMsg, "System");

    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { message: notifyMsg },
      true
    );

    return res.status(201).json({
      status: true,
      message: "Rebooking created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error creating rebooking:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ Get all bookings that have rebooking info
exports.getAllRebookingTrials = async (req, res) => {
  try {
    const result = await RebookingService.getAllRebookings();

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "read", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      {
        message: `Fetched ${result.data.length} rebooking records`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Rebooking trials fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching rebookings:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// ✅ Send rebooking email to parents
exports.sendRebookingEmail = async (req, res) => {
  const { bookingId } = req.body;

  if (!bookingId) {
    return res
      .status(400)
      .json({ status: false, message: "bookingId is required" });
  }

  if (DEBUG) {
    console.log("📨 Sending Rebooking Email for bookingId:", bookingId);
  }

  try {
    const result = await RebookingService.sendRebookingEmailToParents({
      bookingId,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "send", result, false);
      return res.status(500).json({
        status: false,
        message: result.message,
        error: result.error,
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "send",
      {
        message: `Rebooking email sent for bookingId ${bookingId}`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      sentTo: result.sentTo,
    });
  } catch (error) {
    console.error("❌ Controller sendRebookingEmail Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "send",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
