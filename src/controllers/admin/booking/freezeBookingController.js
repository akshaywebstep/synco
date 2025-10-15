const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const FreezeBookingService = require("../../../services/admin/booking/freezeBooking");
const { sequelize, Booking } = require("../../../models");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "freeze_booking";

// ✅ Freeze a booking
exports.createFreezeBooking = async (req, res) => {
  const payload = req.body;

  if (DEBUG) console.log("🎯 Freeze Booking Payload:", payload);

  // ✅ Validate request body
  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["bookingId", "freezeStartDate", "freezeDurationMonths"],
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "create", error, false);

    // Get the first error message
    const firstError = Object.values(error)[0];

    return res.status(400).json({
      status: false,
      message: firstError
    });
  }

  try {
    const result = await FreezeBookingService.createFreezeBooking({
      bookingId: payload.bookingId,
      freezeStartDate: payload.freezeStartDate,
      freezeDurationMonths: payload.freezeDurationMonths,
      reasonForFreezing: payload.reasonForFreezing || null,
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
      { message: `Booking #${payload.bookingId} frozen successfully.` },
      true
    );

    // ✅ Notify admins
    const frozenBy = req?.user?.firstName || "An admin";
    await createNotification(
      req,
      "Booking Frozen",
      `${frozenBy} froze booking #${payload.bookingId}.`,
      "System"
    );

    return res.status(201).json({
      status: true,
      message: "Booking frozen successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error freezing booking:", error);
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

// ✅ List freeze bookings
exports.listFreezeBookings = async (req, res) => {
  const filters = req.query; // e.g., ?bookingId=123

  if (DEBUG) console.log("🎯 List Freeze Bookings Filters:", filters);

  try {
    const result = await FreezeBookingService.listFreezeBookings(filters);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "list", result.message, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { message: "Freeze bookings retrieved." },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Freeze bookings fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error listing freeze bookings:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "list",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.reactivateBooking = async (req, res) => {
  const payload = req.body;

  if (DEBUG) console.log("🎯 Reactivate Booking Payload:", payload);

  // Validate request body
  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["bookingId", "reactivateOn"],
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "reactivate", error, false);
    return res.status(400).json({ status: false, ...error });
  }

  const t = await sequelize.transaction();

  try {
    // 🔹 1. Reactivate booking (without classScheduleId or paymentPlanId)
    const result = await FreezeBookingService.reactivateBooking(
      payload.bookingId,
      payload.reactivateOn, // required
      payload.additionalNote // optional
    );

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "reactivate", result, false);
      await t.rollback();
      return res.status(400).json({ status: false, message: result.message });
    }

    const booking = result.data;

    await t.commit();

    // 🔹 2. Log admin activity
    const reactivatedBy = req?.user?.firstName || "An admin";
    await logActivity(
      req,
      PANEL,
      MODULE,
      "reactivate",
      { message: `Booking #${payload.bookingId} reactivated successfully.` },
      true
    );

    // 🔹 3. Notify admins
    await createNotification(
      req,
      "Booking Reactivated",
      `${reactivatedBy} reactivated booking #${payload.bookingId}.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: "Booking reactivated successfully.",
      data: booking,
    });
  } catch (error) {
    await t.rollback();
    console.error("❌ Error reactivating booking:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "reactivate",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.cancelWaitingListSpot = async (req, res) => {
  const payload = req.body;

  if (DEBUG) console.log("🎯 Cancel Waiting List Payload:", payload);

  // ✅ Validate request body
  const { isValid, error } = validateFormData(payload, {
    requiredFields: ["bookingId", "reasonForCancelling"],
  });

  if (!isValid) {
    await logActivity(req, PANEL, MODULE, "cancel", error, false);
    return res.status(400).json({ status: false, ...error });
  }

  try {
    // 🔹 Call Service
    const result = await FreezeBookingService.cancelWaitingListSpot({
      bookingId: payload.bookingId,
      reasonForCancelling: payload.reasonForCancelling,
      additionalNote: payload.additionalNote || null,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "cancel", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    // ✅ Log admin activity
    await logActivity(
      req,
      PANEL,
      MODULE,
      "cancel",
      { message: `Booking #${payload.bookingId} removed from waiting list.` },
      true
    );

    // ✅ Notify admins
    const cancelledBy = req?.user?.firstName || "An admin";
    await createNotification(
      req,
      "Waiting List Spot Cancelled",
      `${cancelledBy} cancelled waiting list spot for booking #${payload.bookingId}.`,
      "System"
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error cancelling waiting list spot:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "cancel",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};
