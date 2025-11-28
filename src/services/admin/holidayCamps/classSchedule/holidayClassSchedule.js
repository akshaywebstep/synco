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

            if (venue) {
                // =====================
                // paymentGroupId → single integer now
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
                // termGroupId → array of IDs
                // =====================
                let termGroupIds = [];
                if (typeof venue.termGroupId === "string") {
                    try {
                        termGroupIds = JSON.parse(venue.termGroupId);
                    } catch {
                        termGroupIds = [];
                    }
                } else if (Array.isArray(venue.termGroupId)) {
                    termGroupIds = venue.termGroupId;
                }

                // =====================
                // Fetch term groups with terms
                // =====================
                if (holidayCampIds.length > 0) {
                    const holidayCamps = await HolidayCamp.findAll({
                        where: { id: holidayCampIds },
                        include: [
                            {
                                model: HolidayCampDates,
                                as: "holidayCampDates",
                                attributes: [
                                    "id",
                                    "termGroupId",
                                    "termName",
                                    "day",
                                    "startDate",
                                    "endDate",
                                    "exclusionDates",
                                    "totalSessions",
                                    "sessionsMap",
                                ],
                            },
                        ],
                    });

                    const holidayCampDateIds = JSON.parse(cls.holidayCampDateIds || "[]").map(Number);

                    for (const holidayCamp of holidayCamps) {
                        for (const term of termGroup.holidayTerms || []) {
                            if (!termIds.includes(term.id)) {
                                continue;
                            }

                            let parsedSessionsMap = [];
                            if (typeof term.sessionsMap === "string") {
                                try {
                                    parsedSessionsMap = JSON.parse(term.sessionsMap);
                                } catch {
                                    parsedSessionsMap = [];
                                }
                            } else {
                                parsedSessionsMap = term.sessionsMap || [];
                            }

                            // ✅ New array to hold only sessions that exist in ClassScheduleTermMap
                            const filteredSessions = [];

                            // ✅ Get all sessionPlanIds that already exist in mapping for this class + term
                            const existingSessionPlanIds = mappings
                                .filter(
                                    (m) =>
                                        m.classScheduleId === cls.id &&
                                        m.termGroupId === termGroup.id &&
                                        m.termId === term.id
                                )
                                .map((m) => m.sessionPlanId);

                            for (let i = 0; i < parsedSessionsMap.length; i++) {
                                const entry = parsedSessionsMap[i];
                                if (!entry.sessionPlanId) continue;

                                // 🧩 Skip sessions that were newly added in term.sessionMap (not in mapping yet)
                                if (!existingSessionPlanIds.includes(entry.sessionPlanId)) {
                                    continue;
                                }

                                const spg = await HolidaySessionPlanGroup.findByPk(
                                    entry.sessionPlanId,
                                    {
                                        attributes: [
                                            "id",
                                            "groupName",
                                            "levels",
                                            "type",
                                            "pinned",
                                            "beginner_video",
                                            "intermediate_video",
                                            "advanced_video",
                                            "pro_video",
                                            "banner",
                                            "player",
                                            "beginner_upload",
                                            "intermediate_upload",
                                            "advanced_upload",
                                            "pro_upload",
                                            "createdBy",
                                            "createdAt",
                                        ],
                                    }
                                );

                                if (!spg) continue;

                                const relatedMappings = mappings.filter(
                                    (m) =>
                                        m.classScheduleId === cls.id &&
                                        m.termGroupId === termGroup.id &&
                                        m.termId === term.id &&
                                        m.sessionPlanId === entry.sessionPlanId
                                );

                                if (relatedMappings.length === 0) continue;

                                // 🧩 Parse levels safely
                                let levels = {};
                                try {
                                    levels =
                                        typeof spg.levels === "string"
                                            ? JSON.parse(spg.levels)
                                            : spg.levels || {};
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
                                for (const level of [
                                    "beginner",
                                    "intermediate",
                                    "advanced",
                                    "pro",
                                ]) {
                                    if (spg[`${level}_video`]) {
                                        videoUploadedAgo[`${level}_video`] = getElapsedTime(
                                            spg.createdAt
                                        );
                                    } else {
                                        videoUploadedAgo[`${level}_video`] = null;
                                    }
                                }

                                const mapping =
                                    relatedMappings[i] || relatedMappings[0] || null;

                                entry.sessionPlan = {
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
                                    ...(mapping
                                        ? {
                                            mapId: mapping.id,
                                            classScheduleId: mapping.classScheduleId,
                                            termGroupId: mapping.termGroupId,
                                            termId: mapping.termId,
                                            sessionPlanId: mapping.sessionPlanId,
                                            cancelSession: await (async () => {
                                                const cancelled =
                                                    await getCancelledSessionBySessionPlanId(
                                                        mapping.id,
                                                        mapping.sessionPlanId
                                                    );
                                                return cancelled?.status
                                                    ? cancelled.cancelSession
                                                    : {};
                                            })(),
                                            status: mapping.status,
                                            createdAt: mapping.createdAt,
                                            updatedAt: mapping.updatedAt,
                                        }
                                        : {}),
                                };

                                // ✅ Only push if mapping exists
                                filteredSessions.push(entry);
                            }

                            // ✅ Replace with filtered sessions only
                            term.dataValues.sessionsMap = filteredSessions;
                        }

                        // ✅ Remove empty terms
                        termGroup.holidayTerms = (termGroup.holidayTerms || []).filter(
                            (t) => (t.dataValues.sessionsMap || []).length > 0
                        );
                    }

                    // ✅ Remove empty term groups
                    const filteredTermGroups = termGroups.filter(
                        (tg) => (tg.holidayTerms || []).length > 0
                    );

                    venue.dataValues.termGroups = filteredTermGroups;
                }
            } else {
                // venue is null — avoid crash
                cls.dataValues.venue = null;
                console.warn(`⚠️ ClassSchedule ${cls.id} has no venue`);
            }
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
            // paymentGroupId → single integer
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
            // termGroupId → array of IDs
            // =====================
            let termGroupIds = [];
            if (typeof venue.termGroupId === "string") {
                try {
                    termGroupIds = JSON.parse(venue.termGroupId);
                } catch {
                    termGroupIds = [];
                }
            } else if (Array.isArray(venue.termGroupId)) {
                termGroupIds = venue.termGroupId;
            }

            // Fetch all mappings once (for this class)
            const mappings = await HolidayClassScheduleTermMap.findAll({
                where: { classScheduleId: cls.id },
            });

            // =====================
            // Fetch term groups with terms
            // =====================
            if (termGroupIds.length > 0) {
                const termGroups = await HolidayTermGroup.findAll({
                    where: { id: termGroupIds },
                    include: [
                        {
                            model: HolidayTerm,
                            as: "holidayTerms",
                            attributes: [
                                "id",
                                "termGroupId",
                                "termName",
                                "day",
                                "startDate",
                                "endDate",
                                "exclusionDates",
                                "totalSessions",
                                "sessionsMap",
                            ],
                        },
                    ],
                });

                for (const termGroup of termGroups) {
                    for (const term of termGroup.terms || []) {
                        if (typeof term.exclusionDates === "string") {
                            try {
                                term.dataValues.exclusionDates = JSON.parse(
                                    term.exclusionDates
                                );
                            } catch {
                                term.dataValues.exclusionDates = [];
                            }
                        }

                        let parsedSessionsMap = [];
                        if (typeof term.sessionsMap === "string") {
                            try {
                                parsedSessionsMap = JSON.parse(term.sessionsMap);
                            } catch {
                                parsedSessionsMap = [];
                            }
                        } else {
                            parsedSessionsMap = term.sessionsMap || [];
                        }

                        // ✅ Corrected loop: only include sessions present in ClassScheduleTermMap
                        const filteredSessions = [];

                        for (let i = 0; i < parsedSessionsMap.length; i++) {
                            const entry = parsedSessionsMap[i];
                            if (!entry.sessionPlanId) continue;

                            const spg = await HolidaySessionPlanGroup.findByPk(entry.sessionPlanId, {
                                attributes: [
                                    "id",
                                    "groupName",
                                    "levels",
                                    "type",
                                    "pinned",
                                    "beginner_video",
                                    "intermediate_video",
                                    "advanced_video",
                                    "pro_video",
                                    "banner",
                                    "player",
                                    "beginner_upload",
                                    "intermediate_upload",
                                    "advanced_upload",
                                    "pro_upload",
                                    "createdBy",
                                    "createdAt",
                                ],
                            });

                            if (!spg) continue;

                            // ✅ Only include if mapping exists in ClassScheduleTermMap
                            const relatedMappings = mappings.filter(
                                (m) =>
                                    m.classScheduleId === cls.id &&
                                    m.termGroupId === termGroup.id &&
                                    m.termId === term.id &&
                                    m.sessionPlanId === spg.id
                            );

                            if (relatedMappings.length === 0) continue; // skip sessions not in map

                            // Parse levels safely
                            let levels = {};
                            try {
                                levels =
                                    typeof spg.levels === "string"
                                        ? JSON.parse(spg.levels)
                                        : spg.levels || {};
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

                            // Uploaded ago calculation
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

                            // Build combined video info (duration + uploadedAgo)
                            const videoUploadedAgo = {};

                            for (const level of [
                                "beginner",
                                "intermediate",
                                "advanced",
                                "pro",
                            ]) {
                                const video = spg[`${level}_video`];

                                const videoPath =
                                    typeof video === "string"
                                        ? video
                                        : video?.path || video?.url || null;

                                if (videoPath) {
                                    try {
                                        const durationInSeconds = await getVideoDurationInSeconds(
                                            videoPath
                                        );
                                        const formattedDuration = formatDuration(durationInSeconds);

                                        videoUploadedAgo[`${level}_video_duration`] =
                                            formattedDuration;
                                        videoUploadedAgo[`${level}_video_uploadedAgo`] =
                                            getElapsedTime(spg.createdAt);
                                    } catch (err) {
                                        console.error(
                                            `Error getting duration for ${level} video:`,
                                            err
                                        );
                                        videoUploadedAgo[`${level}_video_duration`] = null;
                                        videoUploadedAgo[`${level}_video_uploadedAgo`] =
                                            getElapsedTime(spg.createdAt);
                                    }
                                } else {
                                    videoUploadedAgo[`${level}_video_duration`] = null;
                                    videoUploadedAgo[`${level}_video_uploadedAgo`] = null;
                                }
                            }

                            const mapping = relatedMappings[i] || relatedMappings[0] || null;

                            entry.sessionPlan = {
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
                                ...(mapping
                                    ? {
                                        mapId: mapping.id,
                                        classScheduleId: mapping.classScheduleId,
                                        termGroupId: mapping.termGroupId,
                                        termId: mapping.termId,
                                        sessionPlanId: mapping.sessionPlanId,
                                        status: mapping.status,
                                        createdAt: mapping.createdAt,
                                        updatedAt: mapping.updatedAt,
                                    }
                                    : {}),
                            };

                            // ✅ Add only mapped sessions
                            filteredSessions.push(entry);
                        }

                        // ✅ Replace the old sessionsMap with filtered result
                        term.dataValues.sessionsMap = filteredSessions;
                    }
                }

                venue.dataValues.termGroups = termGroups;
            } else {
                venue.dataValues.termGroups = [];
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
