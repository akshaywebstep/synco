const { logActivity } = require("../../../utils/admin/activityLogger");
const {
    getAllHolidayVenuesWithHolidayClasses,
    getHolidayClassById,
    updateHolidayBookingsForParent,
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

exports.updateHolidayBooking = async (req, res) => {
    try {
        const formData = req.body;

        const parentAdminId = req.admin?.id || null;

        if (!parentAdminId) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized: Only parents can update",
            });
        }

        // ------------------------------------------------------------
        // 🔎 Step 1: Validate Students (ONLY new students strictly)
        // ------------------------------------------------------------
        if (Array.isArray(formData.students)) {
            for (const [index, student] of formData.students.entries()) {
                const requiredFields = [
                    "studentFirstName",
                    "studentLastName",
                    "dateOfBirth",
                    "medicalInformation",
                ];

                for (const field of requiredFields) {
                    if (student[field] === "") {
                        return res.status(400).json({
                            status: false,
                            message: `Student ${index + 1} ${field} cannot be empty`,
                        });
                    }
                }

                if (!student.id) {
                    for (const field of requiredFields) {
                        if (!student[field] || student[field].toString().trim() === "") {
                            return res.status(400).json({
                                status: false,
                                message: `New Student ${index + 1} ${field} is required`,
                            });
                        }
                    }
                }
            }
        }

        // ------------------------------------------------------------
        // 🔎 Step 2: Validate Parents (ONLY new parents strictly)
        // ------------------------------------------------------------
        if (Array.isArray(formData.parents)) {
            for (const [index, parent] of formData.parents.entries()) {
                const requiredFields = [
                    "parentFirstName",
                    "parentLastName",
                    "parentEmail",
                    "parentPhoneNumber",
                    "relationToChild",
                    "howDidYouHear",
                ];

                for (const field of requiredFields) {
                    if (parent[field] === "") {
                        return res.status(400).json({
                            status: false,
                            message: `Parent ${index + 1} ${field} cannot be empty`,
                        });
                    }
                }

                if (!parent.id) {
                    for (const field of requiredFields) {
                        if (!parent[field] || parent[field].trim() === "") {
                            return res.status(400).json({
                                status: false,
                                message: `New Parent ${index + 1} ${field} is required`,
                            });
                        }
                    }
                }
            }
        }

        // ------------------------------------------------------------
        // 🔎 Step 3: Validate Emergency Contacts (ONLY new)
        // ------------------------------------------------------------
        if (Array.isArray(formData.emergencyContacts)) {
            for (const [index, emergency] of formData.emergencyContacts.entries()) {
                const requiredFields = [
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation",
                ];

                for (const field of requiredFields) {
                    if (emergency[field] === "") {
                        return res.status(400).json({
                            status: false,
                            message: `Emergency Contact ${index + 1} ${field} cannot be empty`,
                        });
                    }
                }

                if (!emergency.id) {
                    for (const field of requiredFields) {
                        if (!emergency[field] || emergency[field].trim() === "") {
                            return res.status(400).json({
                                status: false,
                                message: `New Emergency Contact ${index + 1} ${field} is required`,
                            });
                        }
                    }
                }
            }
        }

        // ------------------------------------------------------------
        // ⚙️ Step 4: Call Combined Update Service
        // ------------------------------------------------------------
        const result = await updateHolidayBookingsForParent(
            formData,
            { parentAdminId }
        );

        // ------------------------------------------------------------
        // 📝 Step 5: Logs & Notifications (ADMIN only)
        // ------------------------------------------------------------
        const role = req.admin?.role || null;

        if (role === "Parent") {
            await logActivity(req, PANEL, MODULE, "update", formData, true);

            await createNotification(
                req,
                "Holiday Booking Updated Successfully",
                `Booking updated by ${req.admin?.firstName || "Parent"} ${req.admin?.lastName || ""}.`,
                "System"
            );
        }

        // ------------------------------------------------------------
        // 📤 Step 6: Response
        // ------------------------------------------------------------
        return res.status(200).json({
            status: true,
            message: "Holiday Booking updated successfully",
            data: result.details,
        });
    } catch (error) {
        console.error("❌ updateHolidayBooking Error:", error.message);

        return res.status(500).json({
            status: false,
            message: DEBUG ? error.message : "Internal server error",
        });
    }
};
