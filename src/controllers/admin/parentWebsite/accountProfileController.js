const accountProfileService = require("../../../services/admin/parentWebsite/accountProfileService");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "parent";
const MODULE = "bookings";

/**
 * @desc    Get all bookings for Parent (Classes + OneToOne + Birthday + Holiday)
 * @route   GET /api/parent/bookings
 * @access  Parent (JWT)
 */
exports.getCombinedBookingsByParentAdminId = async (req, res) => {
    try {
        // ✅ Authenticated admin from middleware
        const parentAdminId = req.admin?.id;

        if (!parentAdminId) {
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
            return res.status(404).json({
                status: false,
                panel: PANEL,
                module: MODULE,
                message: result?.message || "Bookings not found.",
            });
        }

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

        return res.status(500).json({
            status: false,
            panel: PANEL,
            module: MODULE,
            message: "Internal server error",
            error: DEBUG ? error.message : undefined,
        });
    }
};
