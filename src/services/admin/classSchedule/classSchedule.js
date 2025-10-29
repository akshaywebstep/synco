const {
  CancelSession,
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

//new
exports.getAllClasses = async (adminId) => {
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
        console.log("🔹 Function called with mapId:", mapId, "sessionPlanId:", sessionPlanId);

        // ✅ Validate input: both IDs are required
        if (!mapId || !sessionPlanId) {
          console.log("⚠️ mapId and sessionPlanId are required");
          return { status: false, message: "Both mapId and sessionPlanId are required." };
        }

        // Fetch only the first cancelled session matching both IDs
        console.log("⏳ Fetching first CancelSession with mapId and sessionPlanId...");
        const cancelSession = await CancelSession.findOne({
          where: {
            mapId,
            sessionPlanGroupId: sessionPlanId,
          },
          order: [["cancelledAt", "ASC"]], // earliest cancellation first
        });

        if (!cancelSession) {
          console.log(`⚠️ No cancelled session found for mapId=${mapId}, sessionPlanId=${sessionPlanId}`);
          return { status: false, message: "Cancelled session not found." };
        }

        console.log("✔️ Found cancelled session ID:", cancelSession.id);
        return { status: true, cancelSession };

      } catch (error) {
        console.error("❌ Error fetching cancelled session:", error);
        return { status: false, message: "Something went wrong.", error: error.message };
      }
    }

    const classes = await ClassSchedule.findAll({
      where: { createdBy: Number(adminId) },
      order: [["id", "ASC"]],
      include: [{ model: Venue, as: "venue" }],
    });

    // Fetch all mappings once
    const mappings = await ClassScheduleTermMap.findAll();

    for (const cls of classes) {
      const venue = cls.venue;

      if (venue) {
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

          // for (const termGroup of termGroups) {
          //   for (const term of termGroup.terms || []) {
          //     if (typeof term.exclusionDates === "string") {
          //       try {
          //         term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
          //       } catch {
          //         term.dataValues.exclusionDates = [];
          //       }
          //     }

          //     let parsedSessionsMap = [];
          //     if (typeof term.sessionsMap === "string") {
          //       try {
          //         parsedSessionsMap = JSON.parse(term.sessionsMap);
          //       } catch {
          //         parsedSessionsMap = [];
          //       }
          //     } else {
          //       parsedSessionsMap = term.sessionsMap || [];
          //     }

          //     // ✅ New array to hold only sessions that exist in ClassScheduleTermMap
          //     const filteredSessions = [];

          //     for (let i = 0; i < parsedSessionsMap.length; i++) {
          //       const entry = parsedSessionsMap[i];
          //       if (!entry.sessionPlanId) continue;

          //       const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
          //         attributes: [
          //           "id",
          //           "groupName",
          //           "levels",
          //           "type",
          //           "pinned",
          //           "beginner_video",
          //           "intermediate_video",
          //           "advanced_video",
          //           "pro_video",
          //           "banner",
          //           "player",
          //           "beginner_upload",
          //           "intermediate_upload",
          //           "advanced_upload",
          //           "pro_upload",
          //           "createdBy",
          //           "createdAt",
          //         ],
          //       });

          //       if (!spg) continue;
          //       // ✅ Only include sessions that already exist in ClassScheduleTermMap (based on sessionPlanId)
          //       const relatedMappings = mappings.filter(
          //         (m) =>
          //           m.classScheduleId === cls.id &&
          //           m.termGroupId === termGroup.id &&
          //           m.termId === term.id &&
          //           m.sessionPlanId === entry.sessionPlanId // <-- match by sessionPlanId only
          //       );

          //       // 🧩 Skip sessions that were newly added in term.sessionMap (not in mapping yet)
          //       if (relatedMappings.length === 0) {
          //         continue;
          //       }

          //       // 🧩 Rest of your logic (unchanged)
          //       let levels = {};
          //       try {
          //         levels =
          //           typeof spg.levels === "string"
          //             ? JSON.parse(spg.levels)
          //             : spg.levels || {};
          //       } catch {
          //         levels = {};
          //       }

          //       const allExercises = await SessionExercise.findAll({
          //         where: { createdBy: spg.createdBy },
          //       });
          //       const exerciseMap = allExercises.reduce((acc, ex) => {
          //         acc[ex.id] = ex;
          //         return acc;
          //       }, {});

          //       for (const levelKey of Object.keys(levels)) {
          //         for (const item of levels[levelKey]) {
          //           if (Array.isArray(item.sessionExerciseId)) {
          //             item.sessionExercises = item.sessionExerciseId
          //               .map((exId) => exerciseMap[exId])
          //               .filter(Boolean)
          //               .map((ex) => ({
          //                 id: ex.id,
          //                 title: ex.title,
          //                 description: ex.description,
          //                 duration: ex.duration,
          //                 imageUrl: ex.imageUrl,
          //               }));
          //           } else {
          //             item.sessionExercises = [];
          //           }
          //         }
          //       }

          //       const getElapsedTime = (createdAt) => {
          //         const now = new Date();
          //         const created = new Date(createdAt);
          //         const diffMs = now - created;
          //         const diffSeconds = Math.floor(diffMs / 1000);
          //         const diffMinutes = Math.floor(diffSeconds / 60);
          //         const diffHours = Math.floor(diffMinutes / 60);
          //         const diffDays = Math.floor(diffHours / 24);
          //         if (diffDays > 0) return `${diffDays} day(s) ago`;
          //         if (diffHours > 0) return `${diffHours} hour(s) ago`;
          //         if (diffMinutes > 0) return `${diffMinutes} minute(s) ago`;
          //         return `${diffSeconds} second(s) ago`;
          //       };

          //       const videoUploadedAgo = {};
          //       for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
          //         if (spg[`${level}_video`]) {
          //           videoUploadedAgo[`${level}_video`] = getElapsedTime(spg.createdAt);
          //         } else {
          //           videoUploadedAgo[`${level}_video`] = null;
          //         }
          //       }

          //       const mapping = relatedMappings[i] || relatedMappings[0] || null;

          //       entry.sessionPlan = {
          //         id: spg.id,
          //         groupName: spg.groupName,
          //         levels,
          //         beginner_video: spg.beginner_video,
          //         intermediate_video: spg.intermediate_video,
          //         advanced_video: spg.advanced_video,
          //         pro_video: spg.pro_video,
          //         banner: spg.banner,
          //         player: spg.player,
          //         videoUploadedAgo,
          //         ...(mapping
          //           ? {
          //             mapId: mapping.id,
          //             classScheduleId: mapping.classScheduleId,
          //             termGroupId: mapping.termGroupId,
          //             termId: mapping.termId,
          //             sessionPlanId: mapping.sessionPlanId,
          //             cancelSession: await (async () => {
          //               const cancelled = await getCancelledSessionBySessionPlanId(
          //                 mapping.id,
          //                 mapping.sessionPlanId
          //               );
          //               return cancelled?.status ? cancelled.cancelSession : {};
          //             })(),
          //             status: mapping.status,
          //             createdAt: mapping.createdAt,
          //             updatedAt: mapping.updatedAt,
          //           }
          //           : {}),
          //       };

          //       // ✅ Only push if mapping exists
          //       filteredSessions.push(entry);
          //     }

          //     // ✅ Replace with filtered sessions only
          //     term.dataValues.sessionsMap = filteredSessions;
          //   }

          //   // ✅ Remove empty terms
          //   termGroup.terms = termGroup.terms.filter(
          //     (t) => (t.dataValues.sessionsMap || []).length > 0
          //   );
          // }

          // // ✅ Remove empty term groups
          // const filteredTermGroups = termGroups.filter(
          //   (tg) => (tg.terms || []).length > 0
          // );

          for (const termGroup of termGroups) {
            for (const term of termGroup.terms || []) {
              if (typeof term.exclusionDates === "string") {
                try {
                  term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
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

                const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
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

                const allExercises = await SessionExercise.findAll({
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
                for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
                  if (spg[`${level}_video`]) {
                    videoUploadedAgo[`${level}_video`] = getElapsedTime(spg.createdAt);
                  } else {
                    videoUploadedAgo[`${level}_video`] = null;
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
                      cancelSession: await (async () => {
                        const cancelled = await getCancelledSessionBySessionPlanId(
                          mapping.id,
                          mapping.sessionPlanId
                        );
                        return cancelled?.status ? cancelled.cancelSession : {};
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
            termGroup.terms = termGroup.terms.filter(
              (t) => (t.dataValues.sessionsMap || []).length > 0
            );
          }

          // ✅ Remove empty term groups
          const filteredTermGroups = termGroups.filter(
            (tg) => (tg.terms || []).length > 0
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

// exports.getClassByIdWithFullDetails = async (classId, createdBy) => {
//   try {
//     // Validate createdBy
//     if (!createdBy || isNaN(Number(createdBy))) {
//       return {
//         status: false,
//         message: "No valid parent or super admin found for this request.",
//         data: [],
//       };
//     }

//     // Fetch class with venue
//     const cls = await ClassSchedule.findOne({
//       where: { id: classId, createdBy: Number(createdBy) },
//       include: [{ model: Venue, as: "venue" }],
//     });

//     const venue = cls.venue;

//     // =====================
//     // termGroupId → array
//     // =====================
//     let termGroupIds = [];
//     if (typeof venue.termGroupId === "string") {
//       try {
//         termGroupIds = JSON.parse(venue.termGroupId);
//       } catch {
//         termGroupIds = [];
//       }
//     } else if (Array.isArray(venue.termGroupId)) {
//       termGroupIds = venue.termGroupId;
//     }

//     // =====================
//     // paymentGroupId → single integer
//     // =====================
//     let paymentGroups = [];
//     if (venue.paymentGroupId) {
//       const pg = await PaymentGroup.findAll({
//         where: { id: venue.paymentGroupId },
//         include: [
//           {
//             model: PaymentPlan,
//             as: "paymentPlans",
//             attributes: [
//               "id",
//               "title",
//               "price",
//               "priceLesson",
//               "interval",
//               "duration",
//               "students",
//               "joiningFee",
//               "HolidayCampPackage",
//               "termsAndCondition",
//               "createdBy",
//               "createdAt",
//               "updatedAt",
//             ],
//           },
//         ],
//         order: [["createdAt", "DESC"]],
//       });
//       paymentGroups = pg;
//     }
//     venue.dataValues.paymentGroups = paymentGroups;

//     // =====================
//     // Fetch term groups with terms & sessions
//     // =====================
//     let termGroups = [];
//     if (termGroupIds.length > 0) {
//       termGroups = await TermGroup.findAll({
//         where: { id: termGroupIds },
//         include: [{ model: Term, as: "terms" }],
//       });

//       for (const group of termGroups) {
//         for (const term of group.terms || []) {
//           // Parse exclusionDates
//           if (typeof term.exclusionDates === "string") {
//             try {
//               term.dataValues.exclusionDates = JSON.parse(term.exclusionDates || "[]");
//             } catch {
//               term.dataValues.exclusionDates = [];
//             }
//           }

//           // Parse sessionsMap
//           let parsedMap = [];
//           if (typeof term.sessionsMap === "string") {
//             try {
//               parsedMap = JSON.parse(term.sessionsMap || "[]");
//             } catch {
//               parsedMap = [];
//             }
//           } else {
//             parsedMap = term.sessionsMap || [];
//           }

//           // Enrich sessionPlan data
//           for (let i = 0; i < parsedMap.length; i++) {
//             const entry = parsedMap[i];
//             if (!entry.sessionPlanId) continue;

//             const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
//               attributes: ["id", "groupName", "levels", "beginner_video",
//                 "intermediate_video",
//                 "advanced_video",
//                 "pro_video", "banner", "player", "beginner_upload",
//                 "intermediate_upload",
//                 "pro_upload",
//                 "advanced_upload",],
//             });

//             if (spg) {
//               entry.sessionPlan = await parseSessionPlanGroupLevels(spg);
//             } else {
//               entry.sessionPlan = null;
//             }
//           }

//           term.dataValues.sessionsMap = parsedMap;
//         }
//       }

//       venue.dataValues.termGroups = termGroups;
//     } else {
//       venue.dataValues.termGroups = [];
//     }

//     return {
//       status: true,
//       message: "Class and full details fetched successfully.",
//       data: cls,
//     };
//   } catch (error) {
//     console.error("❌ getClassByIdWithFullDetails Error:", error.message);
//     return { status: false, message: "Fetch failed: " + error.message };
//   }
// };
exports.getClassByIdWithFullDetails = async (classId, createdBy) => {
  try {
    if (!createdBy || isNaN(Number(createdBy))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const cls = await ClassSchedule.findOne({
      where: { id: classId, createdBy: Number(createdBy) },
      include: [{ model: Venue, as: "venue" }],
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

      // Fetch all mappings once (for this class)
      const mappings = await ClassScheduleTermMap.findAll({
        where: { classScheduleId: cls.id },
      });

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

              const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
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
              const allExercises = await SessionExercise.findAll({
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

              const videoUploadedAgo = {};
              for (const level of ["beginner", "intermediate", "advanced", "pro"]) {
                if (spg[`${level}_video`]) {
                  videoUploadedAgo[`${level}_video`] = getElapsedTime(spg.createdAt);
                } else {
                  videoUploadedAgo[`${level}_video`] = null;
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

// // ✅ Delete class by ID
// exports.deleteClass = async (id) => {
//   try {
//     const deleted = await ClassSchedule.destroy({ where: { id } });
//     if (!deleted) return { status: false, message: "Class not found" };
//     return { status: true, message: "Class deleted successfully." };
//   } catch (error) {
//     console.error("❌ deleteClass Error:", error);
//     return { status: false, message: error.message };
//   }
// };

// ✅ Soft delete a class by ID
exports.deleteClass = async (id, deletedBy) => {
  try {
    // Find the class (not already deleted)
    const classSchedule = await ClassSchedule.findOne({
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

    const mapEntry = await ClassScheduleTermMap.findByPk(id);

    if (!mapEntry) {
      console.log("⚠️ No ClassScheduleTermMap found for ID:", id);
      return { status: false, message: "ClassScheduleTermMap not found." };
    }

    console.log("✔️ Found ClassScheduleTermMap:", mapEntry.id);
    return { status: true, message: "ClassScheduleTermMap fetched successfully.", mapEntry };

  } catch (error) {
    console.error("❌ Error fetching ClassScheduleTermMap:", error);
    return {
      status: false,
      message: "Something went wrong.",
      error: error.message,
    };
  }
};
