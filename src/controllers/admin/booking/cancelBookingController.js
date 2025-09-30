const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const CancelBookingService = require("../../../services/admin/booking/cancelBooking");
// const NoMembershipService = require("../../../services/admin/bookTrials/CancelBooking");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "cancel_free_trial";

// ✅ Cancel a free trial booking
exports.createCancelBooking = async (req, res) => {
  const payload = req.body;

  if (DEBUG) console.log("🎯 Cancel Free Trial Payload:", payload);

  // ✅ Validate request body
  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["bookingId"], // only bookingId required
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "create", error, false);
    return res.status(400).json({ status: false, ...error });
  }

  try {
    // Default cancelDate to null if not provided (immediate cancellation)
    payload.cancelDate = payload.cancelDate || null;

    // Call service specifically for free trial cancellation
    const result = await CancelBookingService.createCancelBooking({
      bookingId: payload.bookingId,
      bookingType: "free", // fixed for free trial
      cancelReason: payload.cancelReason || null,
      additionalNote: payload.additionalNote || null,
      cancelDate: payload.cancelDate,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    // ✅ Log admin activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "create",
      {
        message: `Cancelled free trial booking: bookingId ${payload.bookingId}`,
      },
      true
    );

    // ✅ Notify admins about the cancellation
    const cancelledByName = req?.user?.firstName || "An admin";
    await createNotification(
      req,
      "Trial Cancelled",
      `${cancelledByName} cancelled free trial booking`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Free trial booking cancelled successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error cancelling free trial:", error);

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

// ✅ Get all free trial cancellations
exports.getCancelBookings = async (req, res) => {
  try {
    const result = await CancelBookingService.getCancelBookings();

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "read", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { message: `Fetched ${result.data.length} cancelled free trials` },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Cancelled free trials fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching cancellations:", error);
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

exports.sendCancelBookingEmail = async (req, res) => {
  const { bookingId } = req.body;

  if (!bookingId) {
    return res.status(400).json({
      status: false,
      message: "bookingId is required",
    });
  }

  try {
    const result = await CancelBookingService.sendCancelBookingEmailToParents({
      bookingId,
    });

    if (!result.status) {
      await logActivity(
        req,
        "admin",
        "cancel_free",
        "send",
        result,
        false
      );
      return res.status(500).json({
        status: false,
        message: result.message,
        error: result.error,
      });
    }

    await logActivity(
      req,
      "admin",
      "cancel_free",
      "send",
      { message: `Cancel Free Trial email sent for bookingId ${bookingId}` },
      true
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      sentTo: result.sentTo,
    });
  } catch (error) {
    console.error("❌ Controller sendCancelBookingEmail Error:", error);
    await logActivity(
      req,
      "admin",
      "cancel_free",
      "send",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
