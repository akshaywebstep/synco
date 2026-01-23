const accountProfileService = require("../../../services/admin/parentWebsite/accountProfileService");
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
        const parentAdminId = req.admin?.id;

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
