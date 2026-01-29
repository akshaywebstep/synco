const accountProfileService = require("../../../services/admin/parentWebsite/accountProfileService");
const {
    Booking,
} = require("../../../models");
const { logActivity } = require("../../../utils/admin/activityLogger");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "parent";
const MODULE = "account-profile";

/**
 * @desc    Get all bookings for Parent (Classes + OneToOne + Birthday + Holiday)
 * @route   GET /api/parent/bookings
 * @access  Parent (JWT)
 */
exports.getCombinedBookingsByParentAdminId = async (req, res) => {
    try {
        // ✅ Authenticated parent from middleware
        const parentAdminId = req.parent?.id;

        if (!parentAdminId) {
            await logActivity(
                req,
                PANEL,
                MODULE,
                "list",
                { reason: "Parent admin not found in request" },
                false
            );

            return res.status(401).json({
                status: false,
                panel: PANEL,
                module: MODULE,
                message: "Unauthorized. Parent admin not found.",
            });
        }

        const result =
            await accountProfileService.getCombinedBookingsByParentAdminId(
                parentAdminId
            );

        if (!result?.status) {
            await logActivity(
                req,
                PANEL,
                MODULE,
                "list",
                { reason: result?.message || "No bookings found" },
                false
            );

            return res.status(404).json({
                status: false,
                panel: PANEL,
                module: MODULE,
                message: result?.message || "Bookings not found.",
            });
        }

        // ✅ SUCCESS LOG
        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            {
                totalBookings: result?.data?.combinedBookings?.length || 0,
            },
            true
        );

        return res.status(200).json({
            status: true,
            panel: PANEL,
            module: MODULE,
            message: result.message,
            data: result.data,
        });
    } catch (error) {
        if (DEBUG) {
            console.error(
                `❌ [${PANEL.toUpperCase()}][${MODULE.toUpperCase()}]`,
                error
            );
        }

        // ❌ ERROR LOG
        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            { error: error.message },
            false
        );

        return res.status(500).json({
            status: false,
            panel: PANEL,
            module: MODULE,
            message: "Internal server error",
            error: DEBUG ? error.message : undefined,
        });
    }
};

// ✅ Parent: Schedule cancellation ONLY (no cancelDate)
exports.scheduleCancelMembership = async (req, res) => {
    const payload = req.body;

    if (DEBUG) console.log("👨‍👩‍👧 Parent cancel payload:", payload);

    try {
        // 🔍 Check booking status first
        const booking = await Booking.findByPk(payload.bookingId);

        if (!booking) {
            return res.status(404).json({
                status: false,
                message: "Booking not found.",
            });
        }

        // 🚫 Already requested to cancel
        if (booking.status === "request_to_cancel") {
            return res.status(200).json({
                status: true,
                message:
                    "Your membership cancellation request is already in progress. Your membership will remain active until the end of the current billing period.",
            });
        }

        // 🚫 Already cancelled
        if (booking.status === "cancelled") {
            return res.status(200).json({
                status: true,
                message: "Your membership has already been cancelled.",
            });
        }

        // ✅ Create scheduled cancellation
        const result = await accountProfileService.createCancelBooking({
            bookingId: payload.bookingId,
            bookingType: "membership",
            cancelReason: payload.cancelReason || "Cancelled by parent",
            cancellationType: "scheduled",
            cancelDate: null,
        });

        if (!result.status) {
            return res.status(400).json({
                status: false,
                message: result.message,
            });
        }

        return res.status(200).json({
            status: true,
            message:
                "Your request to cancel your membership has been received. Your membership will remain active until the end of the current billing period.",
        });
    } catch (error) {
        console.error("❌ Parent cancel error:", error);
        return res.status(500).json({
            status: false,
            message: "Server error.",
        });
    }
};
