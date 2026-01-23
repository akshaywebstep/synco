const { logActivity } = require("../../../utils/admin/activityLogger");
const {
    getAllHolidayVenuesWithHolidayClasses,
    getHolidayClassById,
    // getAllTermsForListing,
} = require("../../../services/admin/parentWebsite/holidayService");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "parent";
const MODULE = "find-a-camp";

// 🌍 WEBSITE CONTROLLER — NO ADMIN CONTEXT
exports.findAHolidayClassListing = async (req, res) => {
    try {
        const { lat, lng, range } = req.query;

        // Default fallback location (Brisbane)
        const DEFAULT_LAT = -27.4756;
        const DEFAULT_LNG = 153.02;

        const userLatitude =
            typeof lat !== "undefined" && !isNaN(parseFloat(lat))
                ? parseFloat(lat)
                : DEFAULT_LAT;

        const userLongitude =
            typeof lng !== "undefined" && !isNaN(parseFloat(lng))
                ? parseFloat(lng)
                : DEFAULT_LNG;

        const searchRadiusMiles =
            typeof range !== "undefined" && !isNaN(parseFloat(range))
                ? parseFloat(range)
                : null;

        if (DEBUG) {
            console.log("📥 [WEBSITE] Fetching holiday class listings");
            console.log("➡ Filters:", {
                userLatitude,
                userLongitude,
                searchRadiusMiles,
            });
        }

        const result = await getAllHolidayVenuesWithHolidayClasses({
            userLatitude,
            userLongitude,
            searchRadiusMiles,
        });

        if (!result.status) {
            await logActivity(
                req,
                PANEL,
                MODULE,
                "list",
                { reason: result.message || "Service failed" },
                false
            );

            return res.status(500).json({
                status: false,
                message: result.message || "Failed to fetch class listings",
            });
        }

        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            { count: result.data.length },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Class listings fetched successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ findAHolidayClassListing Error:", error);

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
            message: "Server error.",
        });
    }
};
// GET CLASS SCHEDULE BY - classScheduleId
exports.getHolidayClassScheduleById = async (req, res) => {
    const { id } = req.params;

    if (DEBUG) {
        console.log(`🔍 [WEBSITE] Fetching holiday class schedule ID: ${id}`);
    }

    try {
        // ✅ Website call — ONLY class ID
        const result = await getHolidayClassById(id);

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Not found:", result.message);

            await logActivity(
                req,
                PANEL,
                MODULE,
                "getById",
                { reason: result.message || "Not found" },
                false
            );

            return res.status(404).json({
                status: false,
                message: result.message || "Class not found",
            });
        }

        if (DEBUG) console.log("✅ Data fetched");

        await logActivity(
            req,
            PANEL,
            MODULE,
            "getById",
            { oneLineMessage: `Fetched holiday class schedule ID: ${id}` },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Class and venue fetched successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ getHolidayClassScheduleById Error:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "getById",
            { error: error.message },
            false
        );

        return res.status(500).json({
            status: false,
            message: "Server error.",
        });
    }
};

