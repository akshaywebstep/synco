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

// ✅ GET ALL TERMS (by admin)
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
        const enrichedTerms = parsedCamps.map(
            ({ _parsedSessions, ...rest }) => ({
                ...rest,
                sessionsMap: _parsedSessions.map((s) => ({
                    sessionDate: s.sessionDate,
                    sessionPlanId: s.sessionPlanId,
                    sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
                })),
            })
        );

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
// exports.getTermsByTermGroupId = async (termGroupIds) => {
//     try {
//         // 🧩 Validate input
//         if (
//             !termGroupIds ||
//             !Array.isArray(termGroupIds) ||
//             termGroupIds.length === 0
//         ) {
//             return {
//                 status: false,
//                 message: "No valid term group IDs provided.",
//                 data: [],
//             };
//         }

//         const terms = await HolidayTerm.findAll({
//             where: { termGroupId: { [Op.in]: termGroupIds } },
//             include: [
//                 {
//                     model: HolidayTermGroup,
//                     as: "holidayTermGroup",
//                     attributes: ["id", "name", "createdAt", "createdBy"],
//                 },
//             ],
//             order: [["createdAt", "DESC"]],
//         });

//         const allSessionPlanIds = [];
//         const parsedTerms = terms.map((term) => {
//             let sessions = [];
//             let exclusions = [];

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

//             // Parse exclusionDates
//             try {
//                 exclusions =
//                     typeof term.exclusionDates === "string"
//                         ? JSON.parse(term.exclusionDates)
//                         : term.exclusionDates;
//             } catch (err) {
//                 console.warn("Invalid exclusionDates:", err);
//             }

//             return {
//                 ...term.toJSON(),
//                 _parsedSessions: sessions,
//                 _parsedExclusionDates: exclusions,
//             };
//         });

//         // Seasonal priority mapping
//         const seasonOrder = { autumn: 1, spring: 2, summer: 3 };
//         function getSeasonPriority(termName) {
//             if (!termName) return 99;
//             const lowerName = termName.toLowerCase();
//             if (lowerName.includes("autumn")) return seasonOrder.autumn;
//             if (lowerName.includes("spring")) return seasonOrder.spring;
//             if (lowerName.includes("summer")) return seasonOrder.summer;
//             return 99; // other terms come last
//         }

//         // Sort parsed terms by season first, then createdAt DESC
//         const sortedParsedTerms = parsedTerms.sort((a, b) => {
//             const aPriority = getSeasonPriority(a.termName);
//             const bPriority = getSeasonPriority(b.termName);

//             if (aPriority !== bPriority) return aPriority - bPriority;

//             return new Date(b.createdAt) - new Date(a.createdAt);
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
//             ({ _parsedSessions, _parsedExclusionDates, ...rest }) => ({
//                 ...rest,
//                 exclusionDates: _parsedExclusionDates,
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
