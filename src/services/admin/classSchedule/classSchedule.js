const {
  ClassSchedule,
  Venue,
  TermGroup,
  Term,
  SessionPlanGroup,
  SessionExercise,
  PaymentPlan,
  ClassScheduleTermMap,
  PaymentGroup,

} = require("../../../models");

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
  const exercises = await SessionExercise.findAll({
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
exports.createClass = async (data) => {
  try {
    const newClass = await ClassSchedule.create(data);
    return { status: true, data: newClass };
  } catch (error) {
    console.error("❌ createClass Error:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Update class by ID
exports.updateClass = async (id, data) => {
  try {
    const cls = await ClassSchedule.findByPk(id);
    if (!cls) return { status: false, message: "Class not found" };

    await cls.update(data);
    return { status: true, data: cls };
  } catch (error) {
    console.error("❌ updateClass Error:", error);
    return { status: false, message: error.message };
  }
};

// exports.getAllClasses = async (adminId) => {
//   try {
//     const classes = await ClassSchedule.findAll({
//       where: { createdBy: adminId },
//       order: [["id", "ASC"]],
//       include: [{ model: Venue, as: "venue" }],
//     });

//     for (const cls of classes) {
//       const venue = cls.venue;

//       // ✅ Parse paymentPlanId
//       let paymentPlanIds = [];
//       if (typeof venue.paymentPlanId === "string") {
//         try {
//           paymentPlanIds = JSON.parse(venue.paymentPlanId);
//           venue.dataValues.paymentPlanId = paymentPlanIds;
//         } catch {
//           paymentPlanIds = [];
//           venue.dataValues.paymentPlanId = [];
//         }
//       } else {
//         paymentPlanIds = venue.paymentPlanId || [];
//       }

//       // ✅ Attach PaymentPlans
//       venue.dataValues.paymentPlans =
//         paymentPlanIds.length > 0
//           ? await PaymentPlan.findAll({ where: { id: paymentPlanIds } })
//           : [];

//       // ✅ Parse termGroupId
//       let termGroupIds = [];
//       if (typeof venue.termGroupId === "string") {
//         try {
//           termGroupIds = JSON.parse(venue.termGroupId);
//         } catch {
//           termGroupIds = [];
//         }
//       } else if (Array.isArray(venue.termGroupId)) {
//         termGroupIds = venue.termGroupId;
//       }

//       // ✅ Fetch term groups
//       if (termGroupIds.length > 0) {
//         const termGroups = await TermGroup.findAll({
//           where: { id: termGroupIds },
//           include: [
//             {
//               model: Term,
//               as: "terms",
//               attributes: [
//                 "id",
//                 "termGroupId",
//                 "termName",
//                 "startDate",
//                 "endDate",
//                 "exclusionDates",
//                 "totalSessions",
//                 "sessionsMap",
//               ],
//             },
//           ],
//         });

//         venue.dataValues.termGroups = termGroups;

//         for (const termGroup of termGroups) {
//           if (termGroup?.terms?.length) {
//             for (const term of termGroup.terms) {
//               // ✅ Parse exclusionDates
//               if (typeof term.exclusionDates === "string") {
//                 try {
//                   term.dataValues.exclusionDates = JSON.parse(
//                     term.exclusionDates
//                   );
//                 } catch {
//                   term.dataValues.exclusionDates = [];
//                 }
//               }

//               // ✅ Parse sessionsMap
//               let parsedSessionsMap = [];
//               if (typeof term.sessionsMap === "string") {
//                 try {
//                   parsedSessionsMap = JSON.parse(term.sessionsMap);
//                   term.dataValues.sessionsMap = parsedSessionsMap;
//                 } catch {
//                   parsedSessionsMap = [];
//                   term.dataValues.sessionsMap = [];
//                 }
//               } else {
//                 parsedSessionsMap = term.sessionsMap || [];
//               }

//               // ✅ Enrich each sessionMap entry with its sessionPlan
//               for (let i = 0; i < parsedSessionsMap.length; i++) {
//                 const entry = parsedSessionsMap[i];
//                 if (!entry.sessionPlanId) continue;

//                 const spg = await SessionPlanGroup.findByPk(
//                   entry.sessionPlanId,
//                   {
//                     attributes: [
//                       "id",
//                       "groupName",
//                       "levels",
//                       "video",
//                       "banner",
//                       "player",
//                     ],
//                   }
//                 );

//                 if (spg) {
//                   await parseSessionPlanGroupLevels(spg);
//                   entry.sessionPlan = spg;
//                 } else {
//                   entry.sessionPlan = null;
//                 }
//               }

//               term.dataValues.sessionsMap = parsedSessionsMap;

//               // ✅ Attach ClassScheduleTermMap entries for this term
//               const mappings = await ClassScheduleTermMap.findAll({
//                 where: {
//                   classScheduleId: cls.id,
//                   termId: term.id,
//                 },
//                 // attributes: [
//                 //   "id",
//                 //   "classScheduleId",
//                 //   "termGroupId",
//                 //   "termId",
//                 //   "sessionPlanId",
//                 //   // "status",
//                 //   "createdAt",
//                 //   "updatedAt",
//                 // ],
//               });

//               term.dataValues.classScheduleTermMaps = mappings;
//             }
//           }
//         }
//       } else {
//         venue.dataValues.termGroups = [];
//       }
//     }

//     return { status: true, data: classes };
//   } catch (error) {
//     console.error("❌ getAllClasses Error:", error);
//     return { status: false, message: error.message };
//   }
// };

exports.getAllClasses = async (adminId) => {
  try {
    const classes = await ClassSchedule.findAll({
      where: { createdBy: adminId },
      order: [["id", "ASC"]],
      include: [{ model: Venue, as: "venue" }],
    });

    for (const cls of classes) {
      const venue = cls.venue;

      // =====================
      // paymentGroupId → single integer now
      // =====================
      let paymentGroups = [];
      if (venue.paymentGroupId) {
        const pg = await PaymentGroup.findAll({
          where: { id: venue.paymentGroupId },
          include: [
            {
              model: PaymentPlan,
              as: "paymentPlans",
              attributes: [
                "id",
                "title",
                "price",
                "priceLesson",
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
      if (termGroupIds.length > 0) {
        const termGroups = await TermGroup.findAll({
          where: { id: termGroupIds },
          include: [
            {
              model: Term,
              as: "terms",
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

        venue.dataValues.termGroups = termGroups;

        for (const termGroup of termGroups) {
          for (const term of termGroup.terms || []) {
            // Parse exclusionDates
            if (typeof term.exclusionDates === "string") {
              try {
                term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
              } catch {
                term.dataValues.exclusionDates = [];
              }
            }

            // Parse and enrich sessionsMap
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

            for (let i = 0; i < parsedSessionsMap.length; i++) {
              const entry = parsedSessionsMap[i];
              if (!entry.sessionPlanId) continue;

              const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
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
                  "beginner_upload",
                  "intermediate_upload",
                  "advanced_upload",
                  "pro_upload",
                  "createdBy",
                  "createdAt",
                ],
              });

              if (spg) {
                // Parse levels safely
                let levels = {};
                try {
                  levels = typeof spg.levels === "string" ? JSON.parse(spg.levels) : spg.levels || {};
                } catch {
                  levels = {};
                }

                // Fetch all exercises for this creator
                const allExercises = await SessionExercise.findAll({
                  where: { createdBy: spg.createdBy },
                });

                const exerciseMap = allExercises.reduce((acc, ex) => {
                  acc[ex.id] = ex;
                  return acc;
                }, {});

                // Enrich each level item with sessionExercises
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
                        }));
                    } else {
                      item.sessionExercises = [];
                    }
                  }
                }

                // ✅ Calculate how long ago videos were uploaded (per level)
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
                  if (spg[`${level}_video`]) {
                    videoUploadedAgo[`${level}_video`] = getElapsedTime(spg.createdAt);
                  } else {
                    videoUploadedAgo[`${level}_video`] = null;
                  }
                }

                // 🔹 Fetch mapping for this sessionPlan
                const mapping = await ClassScheduleTermMap.findOne({
                  where: {
                    classScheduleId: cls.id,
                    termId: term.id,
                    sessionPlanId: entry.sessionPlanId,
                  },
                  raw: true,
                });

                // Assign enriched sessionPlan, flattening mapping fields
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
                  videoUploadedAgo, // ✅ level-wise video upload times
                  ...(mapping || {}),
                };
              } else {
                entry.sessionPlan = null;
              }
            }
            term.dataValues.sessionsMap = parsedSessionsMap;
          }
        }

        venue.dataValues.termGroups = termGroups;

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

exports.getClassByIdWithFullDetails = async (classId) => {
  try {
    const cls = await ClassSchedule.findOne({
      where: { id: classId },
      include: [{ model: Venue, as: "venue" }],
    });

    if (!cls) {
      return { status: false, message: "Class not found." };
    }

    const venue = cls.venue;

    // =====================
    // termGroupId → array
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
    // paymentGroupId → single integer
    // =====================
    let paymentGroups = [];
    if (venue.paymentGroupId) {
      const pg = await PaymentGroup.findAll({
        where: { id: venue.paymentGroupId },
        include: [
          {
            model: PaymentPlan,
            as: "paymentPlans",
            attributes: [
              "id",
              "title",
              "price",
              "priceLesson",
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
    // Fetch term groups with terms & sessions
    // =====================
    let termGroups = [];
    if (termGroupIds.length > 0) {
      termGroups = await TermGroup.findAll({
        where: { id: termGroupIds },
        include: [{ model: Term, as: "terms" }],
      });

      for (const group of termGroups) {
        for (const term of group.terms || []) {
          // Parse exclusionDates
          if (typeof term.exclusionDates === "string") {
            try {
              term.dataValues.exclusionDates = JSON.parse(term.exclusionDates || "[]");
            } catch {
              term.dataValues.exclusionDates = [];
            }
          }

          // Parse sessionsMap
          let parsedMap = [];
          if (typeof term.sessionsMap === "string") {
            try {
              parsedMap = JSON.parse(term.sessionsMap || "[]");
            } catch {
              parsedMap = [];
            }
          } else {
            parsedMap = term.sessionsMap || [];
          }

          // Enrich sessionPlan data
          for (let i = 0; i < parsedMap.length; i++) {
            const entry = parsedMap[i];
            if (!entry.sessionPlanId) continue;

            const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: ["id", "groupName", "levels", "beginner_video",
                "intermediate_video",
                "advanced_video",
                "pro_video", "banner", "player", "beginner_upload",
                "intermediate_upload",
                "pro_upload",
                "advanced_upload",],
            });

            if (spg) {
              entry.sessionPlan = await parseSessionPlanGroupLevels(spg);
            } else {
              entry.sessionPlan = null;
            }
          }

          term.dataValues.sessionsMap = parsedMap;
        }
      }

      venue.dataValues.termGroups = termGroups;
    } else {
      venue.dataValues.termGroups = [];
    }

    return {
      status: true,
      message: "Class and full details fetched successfully.",
      data: cls,
    };
  } catch (error) {
    console.error("❌ getClassByIdWithFullDetails Error:", error.message);
    return { status: false, message: "Fetch failed: " + error.message };
  }
};

// ✅ Delete class by ID
exports.deleteClass = async (id) => {
  try {
    const deleted = await ClassSchedule.destroy({ where: { id } });
    if (!deleted) return { status: false, message: "Class not found" };
    return { status: true, message: "Class deleted successfully." };
  } catch (error) {
    console.error("❌ deleteClass Error:", error);
    return { status: false, message: error.message };
  }
};
