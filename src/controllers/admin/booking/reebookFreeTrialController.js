const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const RebookingService = require("../../../services/admin/booking/reebookingFreeTrial"); // updated service
const {
  createNotification,
  createCustomNotificationForAdmins,
} = require("../../../utils/admin/notificationHelper");
const { Booking } = require("../../../models");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "rebooking_trial";

// ✅ Create or update a booking with rebooking info
exports.createRebookingTrial = async (req, res) => {
  console.log("📍 createRebookingTrial reached");
  const payload = req.body;

  // ✅ Field-by-field validation — show one message at a time
  if (!payload.bookingId || payload.bookingId.toString().trim() === "") {
    const message = "bookingId is required";
    if (DEBUG) console.log("❌ Validation failed:", message);
    await logActivity(req, PANEL, MODULE, "create", { message }, false);
    return res.status(400).json({ status: false, message });
  }

  if (
    !payload.reasonForNonAttendance ||
    payload.reasonForNonAttendance.toString().trim() === ""
  ) {
    const message = "reasonForNonAttendance is required";
    if (DEBUG) console.log("❌ Validation failed:", message);
    await logActivity(req, PANEL, MODULE, "create", { message }, false);
    return res.status(400).json({ status: false, message });
  }

  try {
    const result = await RebookingService.createRebooking({
      ...payload,
      createdBy: req?.admin?.id,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(400).json({
        status: false,
        message: result.message,
      });
    }
    // 🔹 Fetch booking to get parentAdminId
    const booking = await Booking.findByPk(payload.bookingId, {
      attributes: ["parentAdminId"],
    });
    // 🔹 Build readable rebooking summary
    const rebookedByName = req?.admin?.firstName || "An admin";

    const rebookedParts = ["trial session rebooked"];

    if (payload.reasonForNonAttendance) {
      rebookedParts.push("due to non-attendance");
    }

    const rebookingSummary = `${rebookedByName} ${rebookedParts.join(" ")}.`;
    // ✅ ADD: Custom notification for parent
    if (booking?.parentAdminId) {
      await createCustomNotificationForAdmins({
        title: "Trial Rebooked",
        description: rebookingSummary, // 👈 clean & friendly
        category: "Updates",
        createdByAdminId: req.admin.id,
        recipientAdminIds: [booking.parentAdminId],
      });
    }

    const notifyMsg = `Trial rebooked for booking ID ${payload.bookingId}`;
    await createNotification(req, "Trial Rebooked", notifyMsg, "System");

    await logActivity(req, PANEL, MODULE, "create", { message: notifyMsg }, true);

    return res.status(201).json({
      status: true,
      message: "Rebooking created successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error creating rebooking:", error);
    await logActivity(req, PANEL, MODULE, "create", { error: error.message }, false);
    return res.status(500).json({
      status: false,
      message: "Server error. Please try again later.",
    });
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
  const { bookingIds } = req.body;

  // ✅ Validation
  if (
    !Array.isArray(bookingIds) ||
    bookingIds.length === 0 ||
    bookingIds.some((id) => typeof id !== "number")
  ) {
    return res.status(400).json({
      status: false,
      message: "bookingIds must be a non-empty array of numbers",
    });
  }

  if (DEBUG) {
    console.log("📨 Sending Rebooking Emails for bookingIds:", bookingIds);
  }

  try {
    const results = [];

    // ✅ Loop through each booking ID
    for (const bookingId of bookingIds) {
      const result = await RebookingService.sendRebookingEmailToParents({
        bookingId,
      });

      // Log each individually
      await logActivity(
        req,
        PANEL,
        MODULE,
        "send",
        {
          message: `Rebooking email result for bookingId ${bookingId}: ${result.message}`,
        },
        result.status
      );

      results.push({
        bookingId,
        status: result.status,
        message: result.message,
        sentTo: result.sentTo || [],
      });
    }

    return res.status(200).json({
      status: true,
      message: `Emails processed for ${bookingIds.length} bookings`,
      results,
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
    return res.status(500).json({
      status: false,
      message: "Server error while sending rebooking emails",
    });
  }
};
