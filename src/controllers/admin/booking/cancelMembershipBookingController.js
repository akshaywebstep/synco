const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const CancelBookingService = require("../../../services/admin/booking/cancelMembershipBooking");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "cancel_membership";

// ✅ Cancel a membership booking
exports.createCancelBooking = async (req, res) => {
  const payload = req.body;
  const cancellationType = (payload.cancellationType ?? (payload.cancelDate ? "scheduled" : "immediate"));

  if (DEBUG) console.log("🎯 Cancel Membership Payload:", payload);

  // ✅ Validate request body
  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["bookingId"],
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "create", error, false);
    return res.status(400).json({ status: false, ...error });
  }

  try {
    // Default cancelDate to null if not provided (immediate cancellation)
    payload.cancelDate = payload.cancelDate || null;

    // Call service specifically for membership cancellation
    const result = await CancelBookingService.createCancelBooking({
      bookingId: payload.bookingId,
      bookingType: "membership", // fixed for membership
      cancelReason: payload.cancelReason || null,
      additionalNote: payload.additionalNote || null,
      cancelDate: payload.cancelDate,
      cancellationType,
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
        message: `Cancelled membership booking: bookingId ${payload.bookingId}`,
      },
      true
    );

    // ✅ Notify admins about the cancellation
    const cancelledByName = req?.user?.firstName || "An admin";
    await createNotification(
      req,
      "Membership Cancelled",
      `${cancelledByName} cancelled membership booking #${payload.bookingId}.`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Membership booking cancelled successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error cancelling membership:", error);

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

// ✅ Send membership cancellation email
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
      bookingType: "membership", // indicate membership
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
        message: `Membership cancellation email sent for bookingId ${bookingId}`,
      },
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
      PANEL,
      MODULE,
      "send",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
