const {
    HolidayCancelSession,
    HolidayClassSchedule,
    HolidayVenue,
    HolidayCamp,
    HolidayCampDates,
    HolidaySessionPlanGroup,
    HolidaySessionExercise,
    HolidayPaymentPlan,
    HolidayClassScheduleTermMap,
    HolidayPaymentGroup,
} = require("../../../../models");

const {
    getVideoDurationInSeconds,
    formatDuration,
} = require("../../../../utils/videoHelper");

const parseSessionPlanGroupLevels = async (spg) => {
    if (!spg?.levels) return spg;

    let parsedLevels = {};
    try {
        parsedLevels =
            typeof spg.levels === "string" ? JSON.parse(spg.levels) : spg.levels;
    } catch {
        parsedLevels = {};
    }

    // Collect all unique sessionExerciseIds
    const allIds = new Set();
    Object.values(parsedLevels).forEach((levelArray) => {
        if (Array.isArray(levelArray)) {
            levelArray.forEach((item) => {
                if (Array.isArray(item.sessionExerciseId)) {
                    item.sessionExerciseId.forEach((id) => allIds.add(id));
                }
            });
        }
    });

    // Fetch all related session exercises
    const exercises = await HolidaySessionExercise.findAll({
        where: { id: [...allIds] },
        attributes: ["id", "title", "description", "imageUrl", "duration"],
    });

    const exerciseMap = {};
    exercises.forEach((ex) => {
        exerciseMap[ex.id] = ex;
    });

    // Attach corresponding exercises directly after sessionExerciseId array
    Object.values(parsedLevels).forEach((levelArray) => {
        if (Array.isArray(levelArray)) {
            levelArray.forEach((item) => {
                if (Array.isArray(item.sessionExerciseId)) {
                    item.sessionExercises = item.sessionExerciseId
                        .map((id) => exerciseMap[id])
                        .filter(Boolean);
                }
            });
        }
    });

    spg.dataValues.levels = parsedLevels;
    return spg;
};

// ✅ Create a new class
exports.createHolidayClass = async (data) => {
    try {
        const newClass = await HolidayClassSchedule.create(data);
        return { status: true, data: newClass };
    } catch (error) {
        console.error("❌ createHolidayClass Error:", error);
        return { status: false, message: error.message };
    }
};

// ✅ Update class by ID
exports.updateHolidayClass = async (id, data) => {
    try {
        const cls = await HolidayClassSchedule.findByPk(id);
        if (!cls) return { status: false, message: "Class not found" };

        await cls.update(data);
        return { status: true, data: cls };
    } catch (error) {
        console.error("❌ updateHolidayClass Error:", error);
        return { status: false, message: error.message };
    }
};

//new
exports.getAllHolidayClasses = async (adminId) => {
    try {
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid parent or super admin found for this request.",
                data: [],
            };
        }

        async function getCancelledSessionBySessionPlanId(mapId, sessionPlanId) {
            try {
                console.log(
                    "🔹 Function called with mapId:",
                    mapId,
                    "sessionPlanId:",
                    sessionPlanId
                );

                // ✅ Validate input: both IDs are required
                if (!mapId || !sessionPlanId) {
                    console.log("⚠️ mapId and sessionPlanId are required");
                    return {
                        status: false,
                        message: "Both mapId and sessionPlanId are required.",
                    };
                }

                // Fetch only the first cancelled session matching both IDs
                console.log(
                    "⏳ Fetching first CancelSession with mapId and sessionPlanId..."
                );
                const cancelSession = await HolidayCancelSession.findOne({
                    where: {
                        mapId,
                        sessionPlanGroupId: sessionPlanId,
                    },
                    order: [["cancelledAt", "ASC"]], // earliest cancellation first
                });

                if (!cancelSession) {
                    console.log(
                        `⚠️ No cancelled session found for mapId=${mapId}, sessionPlanId=${sessionPlanId}`
                    );
                    return { status: false, message: "Cancelled session not found." };
                }

                console.log("✔️ Found cancelled session ID:", cancelSession.id);
                return { status: true, cancelSession };
            } catch (error) {
                console.error("❌ Error fetching cancelled session:", error);
                return {
                    status: false,
                    message: "Something went wrong.",
                    error: error.message,
                };
            }
        }

        const classes = await HolidayClassSchedule.findAll({
            where: { createdBy: Number(adminId) },
            order: [["id", "ASC"]],
            include: [{ model: HolidayVenue, as: "venue" }],
        });

        // Fetch all mappings once
        const mappings = await HolidayClassScheduleTermMap.findAll();

        for (const cls of classes) {
            const venue = cls.venue;

            if (!venue) {
                cls.dataValues.venue = null;
                console.warn(`⚠️ ClassSchedule ${cls.id} has no venue`);
                continue;
            }

            // =====================
            // Attach paymentGroups if exists
            // =====================
            let paymentGroups = [];
            if (venue.paymentGroupId) {
                const pg = await HolidayPaymentGroup.findAll({
                    where: { id: venue.paymentGroupId },
                    include: [
                        {
                            model: HolidayPaymentPlan,
                            as: "holidayPaymentPlans",
                            attributes: [
                                "id",
                                "title",
                                "price",
                                "interval",
                                "duration",
                                "students",
                                "joiningFee",
                                "HolidayCampPackage",
                                "termsAndCondition",
                                "createdBy",
                                "createdAt",
                                "updatedAt",
                            ],
                        },
                    ],
                    order: [["createdAt", "DESC"]],
                });
                paymentGroups = pg;
            }
            venue.dataValues.paymentGroups = paymentGroups;

            // =====================
            // Extract holidayCampIds from venue
            // =====================
            let holidayCampIds = [];
            if (venue.holidayCampId) {
                if (typeof venue.holidayCampId === "string") {
                    try {
                        holidayCampIds = JSON.parse(venue.holidayCampId);
                    } catch {
                        holidayCampIds = venue.holidayCampId
                            .split(",")
                            .map((id) => Number(id.trim()))
                            .filter(Boolean);
                    }
                } else if (Array.isArray(venue.holidayCampId)) {
                    holidayCampIds = venue.holidayCampId;
                } else {
                    holidayCampIds = [venue.holidayCampId];
                }
            }

            if (holidayCampIds.length === 0) {
                venue.dataValues.holidayCamps = [];
                continue;
            }

            // =====================
            // Fetch HolidayCamps with their HolidayCampDates
            // =====================
            const holidayCamps = await HolidayCamp.findAll({
                where: { id: holidayCampIds },
                include: [
                    {
                        model: HolidayCampDates,
                        as: "holidayCampDates",
                        attributes: [
                            "id",
                            "holidayCampId",
                            "startDate",
                            "endDate",
                            "sessionsMap",
                        ],
                    },
                ],
            });

            const holidayCampDateIds = JSON.parse(cls.holidayCampDateIds || "[]").map(Number);

            for (const camp of holidayCamps) {
                for (const date of camp.holidayCampDates || []) {
                    // Only process dates that belong to this class
                    if (!holidayCampDateIds.includes(date.id)) continue;

                    let sessionsMap = [];
                    if (date.sessionsMap) {
                        try {
                            sessionsMap =
                                typeof date.sessionsMap === "string"
                                    ? JSON.parse(date.sessionsMap)
                                    : date.sessionsMap;
                        } catch {
                            sessionsMap = [];
                        }
                    }

                    const filteredSessions = [];

                    for (const session of sessionsMap) {
                        if (!session.sessionPlanId) continue;

                        // Check if mapping exists
                        const mapping = mappings.find(
                            (m) =>
                                m.classScheduleId === cls.id &&
                                m.holidayCampId === camp.id &&
                                m.holidayCampDateId === date.id &&
                                m.sessionPlanId === session.sessionPlanId
                        );

                        if (!mapping) continue;

                        // Fetch session plan group
                        const spg = await HolidaySessionPlanGroup.findByPk(session.sessionPlanId);
                        if (!spg) continue;

                        // Parse levels and attach exercises
                        let levels = {};
                        try {
                            levels = typeof spg.levels === "string" ? JSON.parse(spg.levels) : spg.levels || {};
                        } catch {
                            levels = {};
                        }

                        const allExercises = await HolidaySessionExercise.findAll({
                            where: { createdBy: spg.createdBy },
                        });
                        const exerciseMap = allExercises.reduce((acc, ex) => {
                            acc[ex.id] = ex;
                            return acc;
                        }, {});

                        for (const key of Object.keys(levels)) {
                            for (const item of levels[key]) {
                                if (Array.isArray(item.sessionExerciseId)) {
                                    item.sessionExercises = item.sessionExerciseId
                                        .map((id) => exerciseMap[id])
                                        .filter(Boolean);
                                } else {
                                    item.sessionExercises = [];
                                }
                            }
                        }

                        // Attach mapping info
                        session.sessionPlan = {
                            id: spg.id,
                            groupName: spg.groupName,
                            levels,
                            beginner_video: spg.beginner_video,
                            intermediate_video: spg.intermediate_video,
                            advanced_video: spg.advanced_video,
                            pro_video: spg.pro_video,
                            banner: spg.banner,
                            player: spg.player,
                            mapId: mapping.id,
                            classScheduleId: mapping.classScheduleId,
                            holidayCampId: mapping.holidayCampId,
                            holidayCampDateId: mapping.holidayCampDateId,
                            sessionPlanId: mapping.sessionPlanId,
                            status: mapping.status,
                            createdAt: mapping.createdAt,
                            updatedAt: mapping.updatedAt,
                        };

                        filteredSessions.push(session);
                    }

                    date.dataValues.sessionsMap = filteredSessions;
                }
            }

            venue.dataValues.holidayCamps = holidayCamps;
        }

        return {
            status: true,
            message: "Fetched class schedules successfully.",
            data: classes,
        };
    } catch (error) {
        console.error("❌ getAllClasses Error:", error);
        return { status: false, message: error.message };
    }
};

exports.getHolidayClassByIdWithFullDetails = async (classId, createdBy) => {
    try {
        if (!createdBy || isNaN(Number(createdBy))) {
            return {
                status: false,
                message: "No valid parent or super admin found for this request.",
                data: [],
            };
        }

        const cls = await HolidayClassSchedule.findOne({
            where: { id: classId, createdBy: Number(createdBy) },
            include: [{ model: HolidayVenue, as: "venue" }],
        });

        if (!cls) {
            return { status: false, message: "Class not found.", data: [] };
        }

        const venue = cls.venue;

        if (venue) {
            // =====================
            // Attach paymentGroups if exists
            // =====================
            let paymentGroups = [];
            if (venue.paymentGroupId) {
                const pg = await HolidayPaymentGroup.findAll({
                    where: { id: venue.paymentGroupId },
                    include: [
                        {
                            model: HolidayPaymentPlan,
                            as: "holidayPaymentPlans",
                            attributes: [
                                "id",
                                "title",
                                "price",
                                "interval",
                                "duration",
                                "students",
                                "joiningFee",
                                "HolidayCampPackage",
                                "termsAndCondition",
                                "createdBy",
                                "createdAt",
                                "updatedAt",
                            ],
                        },
                    ],
                    order: [["createdAt", "DESC"]],
                });
                paymentGroups = pg;
            }
            venue.dataValues.paymentGroups = paymentGroups;

            // =====================
            // Extract holidayCampIds from venue
            // =====================
            let holidayCampIds = [];
            if (venue.holidayCampId) {
                if (typeof venue.holidayCampId === "string") {
                    try {
                        holidayCampIds = JSON.parse(venue.holidayCampId);
                    } catch {
                        holidayCampIds = venue.holidayCampId
                            .split(",")
                            .map((id) => Number(id.trim()))
                            .filter(Boolean);
                    }
                } else if (Array.isArray(venue.holidayCampId)) {
                    holidayCampIds = venue.holidayCampId;
                } else {
                    holidayCampIds = [venue.holidayCampId];
                }
            }

            if (holidayCampIds.length === 0) {
                venue.dataValues.holidayCamps = [];
            } else {
                // =====================
                // Fetch all mappings for this class
                // =====================
                const mappings = await HolidayClassScheduleTermMap.findAll({
                    where: { classScheduleId: cls.id },
                });

                // =====================
                // Fetch HolidayCamps with HolidayCampDates
                // =====================
                const holidayCamps = await HolidayCamp.findAll({
                    where: { id: holidayCampIds },
                    include: [
                        {
                            model: HolidayCampDates,
                            as: "holidayCampDates",
                            attributes: [
                                "id",
                                "holidayCampId",
                                "startDate",
                                "endDate",
                                "sessionsMap",
                            ],
                        },
                    ],
                });

                for (const camp of holidayCamps) {
                    for (const date of camp.holidayCampDates || []) {
                        let sessionsMap = [];
                        if (date.sessionsMap) {
                            try {
                                sessionsMap =
                                    typeof date.sessionsMap === "string"
                                        ? JSON.parse(date.sessionsMap)
                                        : date.sessionsMap;
                            } catch {
                                sessionsMap = [];
                            }
                        }

                        const filteredSessions = [];

                        for (const session of sessionsMap) {
                            if (!session.sessionPlanId) continue;

                            const mapping = mappings.find(
                                (m) =>
                                    m.classScheduleId === cls.id &&
                                    m.holidayCampId === camp.id &&
                                    m.holidayCampDateId === date.id &&
                                    m.sessionPlanId === session.sessionPlanId
                            );

                            if (!mapping) continue; // Only include mapped sessions

                            const spg = await HolidaySessionPlanGroup.findByPk(session.sessionPlanId);
                            if (!spg) continue;

                            // Parse levels
                            let levels = {};
                            try {
                                levels = typeof spg.levels === "string" ? JSON.parse(spg.levels) : spg.levels || {};
                            } catch {
                                levels = {};
                            }

                            // Fetch exercises
                            const allExercises = await HolidaySessionExercise.findAll({
                                where: { createdBy: spg.createdBy },
                            });
                            const exerciseMap = allExercises.reduce((acc, ex) => {
                                acc[ex.id] = ex;
                                return acc;
                            }, {});

                            for (const levelKey of Object.keys(levels)) {
                                for (const item of levels[levelKey]) {
                                    if (Array.isArray(item.sessionExerciseId)) {
                                        item.sessionExercises = item.sessionExerciseId
                                            .map((exId) => exerciseMap[exId])
                                            .filter(Boolean)
                                            .map((ex) => ({
                                                id: ex.id,
                                                title: ex.title,
                                                description: ex.description,
                                                duration: ex.duration,
                                                imageUrl: ex.imageUrl,
                                            }));
                                    } else {
                                        item.sessionExercises = [];
                                    }
                                }
                            }

                            // Video info
                            const getElapsedTime = (createdAt) => {
                                const now = new Date();
                                const created = new Date(createdAt);
                                const diffMs = now - created;
                                const diffSeconds = Math.floor(diffMs / 1000);
                                const diffMinutes = Math.floor(diffSeconds / 60);
                                const diffHours = Math.floor(diffMinutes / 60);
                                const diffDays = Math.floor(diffHours / 24);
                                if (diffDays > 0) return `${diffDays} day(s) ago`;
                                if (diffHours > 0) return `${diffHours} hour(s) ago`;
                                if (diffMinutes > 0) return `${diffMinutes} minute(s) ago`;
                                return `${diffSeconds} second(s) ago`;
                            };

                            const videoUploadedAgo = {};
                            for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
                                const video = spg[`${level}_video`];
                                if (video) {
                                    videoUploadedAgo[`${level}_video_uploadedAgo`] = getElapsedTime(spg.createdAt);
                                } else {
                                    videoUploadedAgo[`${level}_video_uploadedAgo`] = null;
                                }
                            }

                            session.sessionPlan = {
                                id: spg.id,
                                groupName: spg.groupName,
                                levels,
                                beginner_video: spg.beginner_video,
                                intermediate_video: spg.intermediate_video,
                                advanced_video: spg.advanced_video,
                                pro_video: spg.pro_video,
                                banner: spg.banner,
                                player: spg.player,
                                videoUploadedAgo,
                                mapId: mapping.id,
                                classScheduleId: mapping.classScheduleId,
                                holidayCampId: mapping.holidayCampId,
                                holidayCampDateId: mapping.holidayCampDateId,
                                sessionPlanId: mapping.sessionPlanId,
                                status: mapping.status,
                                createdAt: mapping.createdAt,
                                updatedAt: mapping.updatedAt,
                            };

                            filteredSessions.push(session);
                        }

                        date.dataValues.sessionsMap = filteredSessions;
                    }
                }

                venue.dataValues.holidayCamps = holidayCamps;
            }
        } else {
            cls.dataValues.venue = null;
            console.warn(`⚠️ ClassSchedule ${cls.id} has no venue`);
        }

        return {
            status: true,
            message: "Fetched class schedule successfully.",
            data: cls,
        };
    } catch (error) {
        console.error("❌ getClassByIdWithFullDetails Error:", error);
        return { status: false, message: error.message };
    }
};

exports.deleteHolidayClass = async (id, deletedBy) => {
    try {
        // Find the class (not already deleted)
        const classSchedule = await HolidayClassSchedule.findOne({
            where: { id, deletedAt: null },
        });

        if (!classSchedule) {
            return { status: false, message: "Class schedule not found." };
        }

        // Track who deleted
        await classSchedule.update({ deletedBy });

        // Soft delete (sets deletedAt automatically because of paranoid)
        await classSchedule.destroy();

        return { status: true, message: "Class schedule deleted successfully." };
    } catch (error) {
        console.error("❌ deleteClass Service Error:", error);
        return {
            status: false,
            message: `Failed to delete class. ${error.message}`,
        };
    }
};

exports.getClassScheduleTermMapById = async (id) => {
    try {
        console.log("🔹 Fetching ClassScheduleTermMap with ID:", id);

        const mapEntry = await HolidayClassScheduleTermMap.findByPk(id);

        if (!mapEntry) {
            console.log("⚠️ No ClassScheduleTermMap found for ID:", id);
            return { status: false, message: "ClassScheduleTermMap not found." };
        }

        console.log("✔️ Found ClassScheduleTermMap:", mapEntry.id);
        return {
            status: true,
            message: "ClassScheduleTermMap fetched successfully.",
            mapEntry,
        };
    } catch (error) {
        console.error("❌ Error fetching ClassScheduleTermMap:", error);
        return {
            status: false,
            message: "Something went wrong.",
            error: error.message,
        };
    }
};
