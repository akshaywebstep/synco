const {
  ClassSchedule,
  Venue,
  TermGroup,
  Term,
  SessionPlanGroup,
  SessionExercise,
  PaymentPlan,
  ClassScheduleTermMap,
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

exports.getAllClasses = async (adminId) => {
  try {
    const classes = await ClassSchedule.findAll({
      where: { createdBy: adminId },
      order: [["id", "ASC"]],
      include: [{ model: Venue, as: "venue" }],
    });

    for (const cls of classes) {
      const venue = cls.venue;

      // ✅ Parse paymentPlanId
      let paymentPlanIds = [];
      if (typeof venue.paymentPlanId === "string") {
        try {
          paymentPlanIds = JSON.parse(venue.paymentPlanId);
          venue.dataValues.paymentPlanId = paymentPlanIds;
        } catch {
          paymentPlanIds = [];
          venue.dataValues.paymentPlanId = [];
        }
      } else {
        paymentPlanIds = venue.paymentPlanId || [];
      }

      // ✅ Attach PaymentPlans
      venue.dataValues.paymentPlans =
        paymentPlanIds.length > 0
          ? await PaymentPlan.findAll({ where: { id: paymentPlanIds } })
          : [];

      // ✅ Parse termGroupId
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

      // ✅ Fetch term groups
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
          if (termGroup?.terms?.length) {
            for (const term of termGroup.terms) {
              // ✅ Parse exclusionDates
              if (typeof term.exclusionDates === "string") {
                try {
                  term.dataValues.exclusionDates = JSON.parse(
                    term.exclusionDates
                  );
                } catch {
                  term.dataValues.exclusionDates = [];
                }
              }

              // ✅ Parse sessionsMap
              let parsedSessionsMap = [];
              if (typeof term.sessionsMap === "string") {
                try {
                  parsedSessionsMap = JSON.parse(term.sessionsMap);
                  term.dataValues.sessionsMap = parsedSessionsMap;
                } catch {
                  parsedSessionsMap = [];
                  term.dataValues.sessionsMap = [];
                }
              } else {
                parsedSessionsMap = term.sessionsMap || [];
              }

              // ✅ Enrich each sessionMap entry with its sessionPlan
              for (let i = 0; i < parsedSessionsMap.length; i++) {
                const entry = parsedSessionsMap[i];
                if (!entry.sessionPlanId) continue;

                const spg = await SessionPlanGroup.findByPk(
                  entry.sessionPlanId,
                  {
                    attributes: [
                      "id",
                      "groupName",
                      "levels",
                      "video",
                      "banner",
                      "player",
                    ],
                  }
                );

                if (spg) {
                  await parseSessionPlanGroupLevels(spg);
                  entry.sessionPlan = spg;
                } else {
                  entry.sessionPlan = null;
                }
              }

              term.dataValues.sessionsMap = parsedSessionsMap;

              // ✅ Attach ClassScheduleTermMap entries for this term
              const mappings = await ClassScheduleTermMap.findAll({
                where: {
                  classScheduleId: cls.id,
                  termId: term.id,
                },
                attributes: [
                  "id",
                  "classScheduleId",
                  "termGroupId",
                  "termId",
                  "sessionPlanId",
                  "status",
                  "createdAt",
                  "updatedAt",
                ],
              });

              term.dataValues.classScheduleTermMaps = mappings;
            }
          }
        }
      } else {
        venue.dataValues.termGroups = [];
      }
    }

    return { status: true, data: classes };
  } catch (error) {
    console.error("❌ getAllClasses Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getClassByIdWithFullDetails = async (classId) => {
  try {
    const cls = await ClassSchedule.findOne({
      where: { id: classId }, // ✅ removed createdBy filter
      include: [{ model: Venue, as: "venue" }],
    });

    if (!cls) {
      return {
        status: false,
        message: "Class not found.",
      };
    }

    const venue = cls.venue;

    let termGroupIds = Array.isArray(venue.termGroupId)
      ? venue.termGroupId
      : typeof venue.termGroupId === "string"
      ? JSON.parse(venue.termGroupId || "[]")
      : [];

    let paymentPlanIds = Array.isArray(venue.paymentPlanId)
      ? venue.paymentPlanId
      : typeof venue.paymentPlanId === "string"
      ? JSON.parse(venue.paymentPlanId || "[]")
      : [];

    let termGroups = [];

    if (termGroupIds.length) {
      termGroups = await TermGroup.findAll({
        where: { id: termGroupIds },
        include: [{ model: Term, as: "terms" }],
      });

      for (const group of termGroups) {
        for (const term of group.terms) {
          if (typeof term.exclusionDates === "string") {
            term.dataValues.exclusionDates = JSON.parse(
              term.exclusionDates || "[]"
            );
          }

          let parsedMap =
            typeof term.sessionsMap === "string"
              ? JSON.parse(term.sessionsMap || "[]")
              : term.sessionsMap || [];

          for (let i = 0; i < parsedMap.length; i++) {
            const entry = parsedMap[i];
            if (!entry.sessionPlanId) continue;

            const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: [
                "id",
                "groupName",
                "levels",
                "video",
                "banner",
                "player",
                "status",
              ],
            });

            entry.sessionPlan = spg
              ? await parseSessionPlanGroupLevels(spg)
              : null;
          }

          term.dataValues.sessionsMap = parsedMap;
        }
      }

      venue.dataValues.termGroups = termGroups;
    }

    if (paymentPlanIds.length) {
      const paymentPlans = await PaymentPlan.findAll({
        where: { id: paymentPlanIds },
      });
      venue.dataValues.paymentPlans = paymentPlans;
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
