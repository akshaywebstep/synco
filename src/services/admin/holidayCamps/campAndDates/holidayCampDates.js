const {
    HolidayCampDates,
    HolidayTermGroup,
    HolidayCamp,
    HolidaySessionPlanGroup,
    HolidaySessionExercise,
} = require("../../../../models");
const { Op } = require("sequelize");
const moment = require("moment");

// ✅ CREATE HOLIDAY TERM

exports.createHolidayCampDates = async (payload) => {
    try {
        const {
            holidayCampId,
            startDate,
            endDate,
            totalDays,
            sessionsMap = [],
            createdBy,
        } = payload;

        // Validate date formats
        if (
            !moment(startDate, "YYYY-MM-DD", true).isValid() ||
            !moment(endDate, "YYYY-MM-DD", true).isValid()
        ) {
            return {
                status: false,
                message: "Invalid date format. Use 'YYYY-MM-DD'.",
            };
        }

        const start = moment(startDate);
        const end = moment(endDate);

        if (!start.isBefore(end)) {
            return {
                status: false,
                message: "Start date must be before end date.",
            };
        }

        // Check camp existence
        const camp = await HolidayCamp.findByPk(holidayCampId);
        if (!camp) {
            return {
                status: false,
                message: `Camp with ID ${holidayCampId} does not exist.`,
            };
        }

        // Create new entry
        const holidayCampDate = await HolidayCampDates.create({
            holidayCampId,
            startDate,
            endDate,
            totalDays,
            sessionsMap,  // JSON
            createdBy,
        });

        return {
            status: true,
            data: holidayCampDate.get({ plain: true }),
        };

    } catch (error) {
        console.error("❌ Error in createHolidayCampDates service:", error);
        return {
            status: false,
            message: error.message || "Failed to create camp date.",
        };
    }
};

function removeNullFields(obj) {
    if (!obj || typeof obj !== "object") return obj;

    return Object.fromEntries(
        Object.entries(obj).filter(([_, value]) => value !== null)
    );
}

// ✅ GET ALL Camp (by admin)
exports.getAllHolidayCampDates = async (adminId) => {
    try {
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid parent or super admin found for this request.",
                data: [],
            };
        }

        // Fetch all camps created by this admin
        const camp = await HolidayCampDates.findAll({
            where: { createdBy: Number(adminId) },
            include: [
                {
                    model: HolidayCamp,
                    as: "holidayCamp",
                    attributes: ["id", "name", "createdAt", "createdBy"],
                },
            ],
            order: [["createdAt", "DESC"]],
        });

        const allSessionPlanIds = [];

        // Parse sessionsMap + collect session plan IDs
        const parsedCamps = camp.map((term) => {
            let sessions = [];

            try {
                sessions =
                    typeof term.sessionsMap === "string"
                        ? JSON.parse(term.sessionsMap)
                        : term.sessionsMap || [];

                if (Array.isArray(sessions)) {
                    allSessionPlanIds.push(...sessions.map((s) => s.sessionPlanId));
                }
            } catch (err) {
                console.warn("Invalid sessionsMap:", err);
            }

            return {
                ...term.toJSON(),
                _parsedSessions: Array.isArray(sessions) ? sessions : [],
            };
        });

        // Unique sessionPlanIds
        const uniquePlanIds = [...new Set(allSessionPlanIds)];

        // Fetch session plan groups
        const sessionPlanGroups = await HolidaySessionPlanGroup.findAll({
            where: { id: { [Op.in]: uniquePlanIds } },
            attributes: [
                "id",
                "groupName",
                "levels",
                "beginner_video",
                "intermediate_video",
                "pro_video",
                "advanced_video",
                "banner",
                "player",
                "type",
                "pinned",
            ],
            raw: true,
        });

        // Parse levels + collect sessionExerciseIds
        const sessionPlanMap = {};
        const allExerciseIds = new Set();

        sessionPlanGroups.forEach((spg) => {
            const levels = JSON.parse(spg.levels || "{}");

            ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
                if (Array.isArray(levels[level])) {
                    levels[level].forEach((entry) => {
                        (entry.sessionExerciseId || []).forEach((id) =>
                            allExerciseIds.add(id)
                        );
                    });
                }
            });

            sessionPlanMap[spg.id] = { ...spg, levels };
        });

        // Fetch exercises
        const sessionExercises = await HolidaySessionExercise.findAll({
            where: { id: { [Op.in]: Array.from(allExerciseIds) } },
            raw: true,
        });

        const exerciseMap = {};
        sessionExercises.forEach((ex) => {
            exerciseMap[ex.id] = ex;
        });

        // Inject exercises back into each plan's levels
        Object.values(sessionPlanMap).forEach((spg) => {
            ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
                if (Array.isArray(spg.levels[level])) {
                    spg.levels[level].forEach((entry) => {
                        entry.sessionExercises = (entry.sessionExerciseId || [])
                            .map((id) => exerciseMap[id])
                            .filter(Boolean);
                    });
                }
            });
        });

        // 🔥 Build final enriched camp data
        const enrichedTerms = parsedCamps.map((item) => ({
            id: item.id,
            holidayCampId: item.holidayCampId,
            startDate: item.startDate,
            endDate: item.endDate,
            totalDays: item.totalDays,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            holidayCamp: item.holidayCamp,

            sessionsMap: item._parsedSessions.map((s) => ({
                sessionDate: s.sessionDate,
                sessionPlanId: s.sessionPlanId,
                sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
            })),
        }));

        return { status: true, data: enrichedTerms };
    } catch (error) {
        console.error("❌ getAllHolidayCamps error:", error);
        return { status: false, message: error.message };
    }
};

// ✅ GET TERM BY ID (by admin)
exports.getHolidayCampDatesById = async (id, adminId) => {
    try {
        const term = await HolidayCampDates.findOne({
            where: { id, createdBy: adminId },
            include: [
                {
                    model: HolidayCamp,
                    as: "holidayCamp",
                    attributes: ["id", "name", "createdAt", "createdBy"],
                },
            ],
        });

        if (!term) {
            return { status: false, message: "Camp not found or unauthorized." };
        }

        // Parse sessionsMap
        let sessions = [];
        try {
            sessions =
                typeof term.sessionsMap === "string"
                    ? JSON.parse(term.sessionsMap)
                    : term.sessionsMap || [];
        } catch (err) {
            console.warn("Invalid sessionsMap format:", err);
        }

        // Collect sessionPlanIds
        const sessionPlanIds = [...new Set(sessions.map((s) => s.sessionPlanId))];

        // Fetch session plan groups
        const sessionPlanGroups = await HolidaySessionPlanGroup.findAll({
            where: { id: { [Op.in]: sessionPlanIds } },
            attributes: [
                "id",
                "groupName",
                "levels",
                "beginner_video",
                "intermediate_video",
                "pro_video",
                "advanced_video",
                "banner",
                "player",
                "type",
                "pinned",
            ],
            raw: true,
        });

        const sessionPlanMap = {};
        const allExerciseIds = new Set();

        // Parse levels & collect exercise IDs
        sessionPlanGroups.forEach((spg) => {
            const levels = JSON.parse(spg.levels || "{}");

            ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
                if (Array.isArray(levels[level])) {
                    levels[level].forEach((entry) => {
                        (entry.sessionExerciseId || []).forEach((id) => {
                            allExerciseIds.add(id);
                        });
                    });
                }
            });

            sessionPlanMap[spg.id] = { ...spg, levels };
        });

        // Fetch exercises
        const sessionExercises = await HolidaySessionExercise.findAll({
            where: { id: { [Op.in]: Array.from(allExerciseIds) } },
            raw: true,
        });

        const exerciseMap = {};
        sessionExercises.forEach((ex) => {
            exerciseMap[ex.id] = ex;
        });

        // Inject exercises into each plan's levels
        Object.values(sessionPlanMap).forEach((spg) => {
            ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
                if (Array.isArray(spg.levels[level])) {
                    spg.levels[level].forEach((entry) => {
                        entry.sessionExercises = (entry.sessionExerciseId || [])
                            .map((id) => exerciseMap[id])
                            .filter(Boolean);
                    });
                }
            });
        });

        // Enrich sessionsMap
        const enrichedSessions = sessions.map((s) => ({
            sessionDate: s.sessionDate,
            sessionPlanId: s.sessionPlanId,
            sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
        }));

        return {
            status: true,
            data: {
                ...term.toJSON(),
                sessionsMap: enrichedSessions,
            },
        };
    } catch (error) {
        console.error("❌ Error getHolidayCampById:", error);
        return { status: false, message: error.message };
    }
};

// ✅ GET TERMS BY TERM GROUP ID
exports.getHolidayCampDateByHolidayCampId = async (holidayCampIds) => {
    try {
        // Validate input
        if (
            !holidayCampIds ||
            !Array.isArray(holidayCampIds) ||
            holidayCampIds.length === 0
        ) {
            return {
                status: false,
                message: "No valid holiday camp IDs provided.",
                data: [],
            };
        }

        // Fetch Holiday Camp Dates
        const holidayCampDates = await HolidayCampDates.findAll({
            where: { holidayCampId: { [Op.in]: holidayCampIds } },
            order: [["createdAt", "DESC"]],
        });

        const allSessionPlanIds = [];

        // Parse each term and extract sessionPlanIds
        const parsedTerms = holidayCampDates.map((holidayCampDate) => {
            let sessions = [];

            try {
                const mapVal =
                    typeof holidayCampDate.sessionsMap === "string"
                        ? JSON.parse(holidayCampDate.sessionsMap)
                        : holidayCampDate.sessionsMap;

                if (Array.isArray(mapVal)) {
                    sessions = mapVal;
                    allSessionPlanIds.push(
                        ...sessions.map((s) => s.sessionPlanId)
                    );
                }
            } catch (err) {
                console.warn("Invalid sessionsMap:", err);
            }

            return {
                ...holidayCampDate.toJSON(),
                _parsedSessions: sessions,
            };
        });

        // Fetch Session Plan Groups
        const uniquePlanIds = [...new Set(allSessionPlanIds)];

        const sessionPlanGroups = await HolidaySessionPlanGroup.findAll({
            where: { id: { [Op.in]: uniquePlanIds } },
            attributes: [
                "id",
                "groupName",
                "levels",
                "beginner_video",
                "intermediate_video",
                "advanced_video",
                "pro_video",
                "banner",
                "player",
                "type",
                "pinned",
            ],
            raw: true,
        });

        // Parse levels and collect exercise IDs
        const sessionPlanMap = {};
        const allExerciseIds = new Set();

        sessionPlanGroups.forEach((spg) => {
            let levels = {};

            try {
                levels = JSON.parse(spg.levels || "{}");
            } catch {
                levels = {};
            }

            ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
                if (Array.isArray(levels[level])) {
                    levels[level].forEach((entry) => {
                        (entry.sessionExerciseId || []).forEach((id) =>
                            allExerciseIds.add(id)
                        );
                    });
                }
            });

            sessionPlanMap[spg.id] = { ...spg, levels };
        });

        // Fetch exercises
        const sessionExercises = await HolidaySessionExercise.findAll({
            where: { id: { [Op.in]: Array.from(allExerciseIds) } },
            raw: true,
        });

        const exerciseMap = {};
        sessionExercises.forEach((ex) => (exerciseMap[ex.id] = ex));

        // Inject exercises into levels
        Object.values(sessionPlanMap).forEach((spg) => {
            ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
                if (Array.isArray(spg.levels[level])) {
                    spg.levels[level].forEach((entry) => {
                        entry.sessionExercises = (entry.sessionExerciseId || [])
                            .map((id) => exerciseMap[id])
                            .filter(Boolean);
                    });
                }
            });
        });

        // Build final enriched response
        const enrichedTerms = parsedTerms.map(({ _parsedSessions, ...rest }) => ({
            ...rest,
            sessionsMap: Array.isArray(_parsedSessions)
                ? _parsedSessions.map((s) => ({
                      sessionDate: s.sessionDate,
                      sessionPlanId: s.sessionPlanId,
                      sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
                  }))
                : [],
        }));

        return { status: true, data: enrichedTerms };
    } catch (error) {
        return { status: false, message: error.message };
    }
};

// exports.getHolidayCampDateByHolidayCampId = async (holidayCampIds) => {
//     try {
//         // 🧩 Validate input
//         if (
//             !holidayCampIds ||
//             !Array.isArray(holidayCampIds) ||
//             holidayCampIds.length === 0
//         ) {
//             return {
//                 status: false,
//                 message: "No valid holiday camp dates group IDs provided.",
//                 data: [],
//             };
//         }

//         const holidayCampDates = await HolidayCampDates.findAll({
//             where: { holidayCampId: { [Op.in]: holidayCampIds } },
//             include: [
//                 {
//                     model: HolidayCampDates,
//                     as: "holidayCampDates",
//                     attributes: ["id", "name", "createdAt", "createdBy"],
//                 },
//             ],
//             order: [["createdAt", "DESC"]],
//         });

//         const allSessionPlanIds = [];
//         const parsedTerms = holidayCampDates.map((holidayCampDate) => {
//             let sessions = [];
           
//             // Parse sessionsMap
//             try {
//                 sessions =
//                     typeof term.sessionsMap === "string"
//                         ? JSON.parse(term.sessionsMap)
//                         : term.sessionsMap;
//                 if (Array.isArray(sessions)) {
//                     allSessionPlanIds.push(...sessions.map((s) => s.sessionPlanId));
//                 }
//             } catch (err) {
//                 console.warn("Invalid sessionsMap:", err);
//             }

//             return {
//                 ...term.toJSON(),
//                 _parsedSessions: sessions,
//             };
//         });

//         // Fetch Session Plan Groups
//         const sessionPlanGroups = await HolidaySessionPlanGroup.findAll({
//             where: { id: { [Op.in]: [...new Set(allSessionPlanIds)] } },
//             attributes: ["id", "groupName", "levels", "beginner_video",
//                 "intermediate_video",
//                 "pro_video",
//                 "advanced_video", "banner", "player", "type", "pinned"],
//             raw: true,
//         });

//         // Parse levels and collect exercise IDs
//         const sessionPlanMap = {};
//         const allExerciseIds = new Set();

//         sessionPlanGroups.forEach((spg) => {
//             const levels = JSON.parse(spg.levels || "{}");

//             ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
//                 if (Array.isArray(levels[level])) {
//                     levels[level].forEach((entry) => {
//                         (entry.sessionExerciseId || []).forEach((id) =>
//                             allExerciseIds.add(id)
//                         );
//                     });
//                 }
//             });

//             sessionPlanMap[spg.id] = { ...spg, levels }; // store parsed levels
//         });

//         // Fetch session exercises
//         const sessionExercises = await HolidaySessionExercise.findAll({
//             where: { id: { [Op.in]: Array.from(allExerciseIds) } },
//             raw: true,
//         });

//         const exerciseMap = {};
//         sessionExercises.forEach((ex) => {
//             exerciseMap[ex.id] = ex;
//         });

//         // Inject sessionExercises into levels
//         Object.values(sessionPlanMap).forEach((spg) => {
//             ["beginner", "intermediate", "advanced", "pro"].forEach((level) => {
//                 if (Array.isArray(spg.levels[level])) {
//                     spg.levels[level].forEach((entry) => {
//                         entry.sessionExercises = (entry.sessionExerciseId || [])
//                             .map((id) => exerciseMap[id])
//                             .filter(Boolean);
//                     });
//                 }
//             });
//         });

//         // Construct final enriched response (omit _parsed fields)
//         const enrichedTerms = sortedParsedTerms.map(
//             ({ _parsedSessions, ...rest }) => ({
//                 ...rest,
//                 sessionsMap: Array.isArray(_parsedSessions)
//                     ? _parsedSessions.map((s) => ({
//                         sessionDate: s.sessionDate,
//                         sessionPlanId: s.sessionPlanId,
//                         sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
//                     }))
//                     : [], // fallback empty array if not valid
//             })
//         );

//         return { status: true, data: enrichedTerms };
//     } catch (error) {
//         return { status: false, message: error.message };
//     }
// };

exports.updateHolidayCampDates = async (id, data, adminId) => {
    try {
        // Find camp owned by admin
        const camp = await HolidayCampDates.findOne({
            where: { id, createdBy: adminId },
        });

        if (!camp) {
            return { status: false, message: "Camp not found or unauthorized." };
        }

        const cleanedData = removeNullFields(data);

        if (Object.keys(cleanedData).length === 0) {
            return { status: false, message: "No valid fields to update." };
        }

        // --- DATE VALIDATION ---

        const startDate = cleanedData.startDate || camp.startDate;
        const endDate = cleanedData.endDate || camp.endDate;

        if (
            !moment(startDate, "YYYY-MM-DD", true).isValid() ||
            !moment(endDate, "YYYY-MM-DD", true).isValid()
        ) {
            return {
                status: false,
                message: "Invalid date format. Use 'YYYY-MM-DD'.",
            };
        }

        const start = moment(startDate);
        const end = moment(endDate);

        if (!start.isBefore(end)) {
            return {
                status: false,
                message: "Start date must be before end date.",
            };
        }

        // --- sessionsMap validation (if provided) ---
        if (cleanedData.sessionsMap) {
            if (!Array.isArray(cleanedData.sessionsMap)) {
                return {
                    status: false,
                    message: "sessionsMap must be an array.",
                };
            }
        }

        // --- UPDATE ---
        await camp.update(cleanedData);

        return {
            status: true,
            data: camp.get({ plain: true }),
        };

    } catch (error) {
        console.error("❌ Error in updateHolidayCamp service:", error);
        return { status: false, message: error.message };
    }
};

// ✅ SOFT DELETE TERM (service)
exports.deleteHolidayCampDates = async (id, deletedBy) => {
    try {
        // Find the camp that belongs to the admin and is not already deleted
        const camp = await HolidayCampDates.findOne({
            where: { id, createdBy: deletedBy, deletedAt: null },
        });

        if (!camp) {
            return { status: false, message: "Camp not found or unauthorized." };
        }

        // Record who deleted it
        await camp.update({ deletedBy });

        // Soft delete (Sequelize automatically sets deletedAt)
        await camp.destroy();

        return { status: true, message: "Camp deleted successfully." };
    } catch (error) {
        console.error("❌ deleteHolidayCampDates Service Error:", error);
        return { status: false, message: "Delete failed. " + error.message };
    }
};
