// const { validateFormData } = require("../../../utils/validateFormData");
const { logActivity } = require("../../../utils/admin/activityLogger");
const CancellationService = require("../../../services/admin/cancellations/requestToCancellation");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");
// const {
//   createNotification,
// } = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "cancellation";

// ✅ Get all membership cancellations
exports.getRequestToCancel = async (req, res) => {
  try {
    const {
      venueName,
      studentName,
      cancellationType,
      fromDate,
      toDate,
      status,
    } = req.query; // ✅ added status

    const bookedBy = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id, true);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // ✅ Build filters from query params
    const filters = {
      bookingType: "membership",
      cancellationType,
      venueName,
      studentName,
      fromDate,
      toDate,
      status
    };

    // ✅ Apply bookedBy filter
    if (req.admin?.role?.toLowerCase() === "super admin") {

      const childAdminIds = (mainSuperAdminResult?.admins || [])
        .map(a => a.id);

      filters.bookedBy = [
        req.admin.id,        // ✅ Super Admin data
        ...childAdminIds,    // ✅ Child admins data
      ];

    } else {
      filters.bookedBy = req.admin.id;
    }

    const result = await CancellationService.getRequestToCancel(filters);

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "read", result, false);
      return res.status(400).json({
        status: false,
        message: result.message || "Failed to fetch cancelled bookings.",
        data: { cancellationData: [], allVenue: [] },
      });
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      {
        message: `Fetched ${result.data.cancellationData.length} cancelled membership bookings`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Cancelled membership bookings fetched successfully.",
      totalRequest: result.data.cancellationData.length,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Error fetching membership cancellations:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error. Please try again later.",
      data: { cancellationData: [], allVenue: [] },
    });
  }
};

exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user?.id || null;

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Booking ID is required.",
      });
    }

    const result = await CancellationService.getFullCancelBookingById(
      id,
      adminId
    );

    if (!result.status) {
      return res.status(404).json({
        status: false,
        message: result.message || "Booking not found.",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Booking fetched successfully.",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getBookingById Controller Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Internal server error.",
    });
  }
};
exports.sendCancelBookingEmail = async (req, res) => {
  const { bookingIds } = req.body;

  if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
    return res.status(400).json({
      status: false,
      message: "bookingIds must be a non-empty array",
    });
  }

  try {
    const result = await CancellationService.sendCancelBookingEmailToParents({
      bookingIds,
    });

    if (!result.status) {
      await logActivity(
        req,
        "admin",
        "cancel_free_trial",
        "send",
        result,
        false
      );
      return res.status(500).json({
        status: false,
        message: result.message,
      });
    }

    await logActivity(
      req,
      "admin",
      "cancel_free_trial",
      "send",
      {
        message: `Cancel Free Trial emails sent for bookingIds: ${bookingIds.join(
          ", "
        )}`,
      },
      true
    );

    return res.status(200).json({
      status: true,
      message: result.message,
      sentTo: result.sentTo,
      errors: result.errors || [],
    });
  } catch (error) {
    console.error("❌ Controller sendCancelBookingEmail Error:", error);
    await logActivity(
      req,
      "admin",
      "cancel_free_trial",
      "send",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
