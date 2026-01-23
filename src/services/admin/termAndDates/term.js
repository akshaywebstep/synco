const {
  Term,
  TermGroup,
  SessionPlanGroup,
  SessionExercise,
} = require("../../../models");
const { Op } = require("sequelize");
const moment = require("moment");

// ✅ CREATE

exports.createTerm = async (payload) => {
  try {
    const {
      termName,
      termGroupId,
      day,
      startDate,
      endDate,
      totalNumberOfSessions,
      exclusionDates = [],
      sessionsMap = [],
      createdBy,
    } = payload;

    // ✅ Validate date formats
    if (
      !moment(startDate, "YYYY-MM-DD", true).isValid() ||
      !moment(endDate, "YYYY-MM-DD", true).isValid()
    ) {
      return {
        status: false,
        message: "Invalid date format. Use 'YYYY-MM-DD'.",
      };
    }

    const start = moment(startDate, "YYYY-MM-DD").startOf("day");
    const end = moment(endDate, "YYYY-MM-DD").endOf("day");

    // ✅ Ensure startDate is before endDate
    if (!start.isBefore(end)) {
      return {
        status: false,
        message: "Start date must be before end date.",
      };
    }
    if (!Array.isArray(exclusionDates)) {
      return {
        status: false,
        message: "Exclusion dates must be an array.",
      };
    }

    // ✅ Check if all exclusionDates are between startDate and endDate
    for (const date of exclusionDates) {
      const exDate = moment(date, "YYYY-MM-DD", true);

      if (!exDate.isValid()) {
        return {
          status: false,
          message: `Invalid exclusion date format: ${date}. Use YYYY-MM-DD.`,
        };
      }

      if (exDate.isBefore(start) || exDate.isAfter(end)) {
        return {
          status: false,
          message: `Exclusion date ${date} must be between ${startDate} and ${endDate}.`,
        };
      }
    }

    // ✅ Check if termGroupId exists
    const group = await TermGroup.findByPk(termGroupId);
    if (!group) {
      return {
        status: false,
        message: `TermGroup with ID ${termGroupId} does not exist.`,
      };
    }

    // ✅ Create term
    const term = await Term.create({
      termName,
      termGroupId,
      day,
      startDate,
      endDate,
      totalSessions: totalNumberOfSessions,
      exclusionDates: JSON.stringify(exclusionDates), // Store as JSON string
      sessionsMap: JSON.stringify(sessionsMap), // Store as JSON string
      createdBy,
    });

    return { status: true, data: term.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error in createTerm service:", error);
    return {
      status: false,
      message: error.message || "Failed to create term.",
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
exports.getAllTerms = async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const terms = await Term.findAll({
      where: { createdBy: Number(adminId) },
      include: [
        {
          model: TermGroup,
          as: "termGroup",
          attributes: ["id", "name", "createdAt", "createdBy"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const allSessionPlanIds = [];
    const parsedTerms = terms.map((term) => {
      let sessions = [];
      let exclusions = [];

      // Parse sessionsMap
      try {
        sessions =
          typeof term.sessionsMap === "string"
            ? JSON.parse(term.sessionsMap)
            : term.sessionsMap;
        if (Array.isArray(sessions)) {
          allSessionPlanIds.push(...sessions.map((s) => s.sessionPlanId));
        }
      } catch (err) {
        console.warn("Invalid sessionsMap:", err);
      }

      // Parse exclusionDates
      try {
        exclusions =
          typeof term.exclusionDates === "string"
            ? JSON.parse(term.exclusionDates)
            : term.exclusionDates;
      } catch (err) {
        console.warn("Invalid exclusionDates:", err);
      }

      return {
        ...term.toJSON(),
        _parsedSessions: sessions,
        _parsedExclusionDates: exclusions,
      };
    });

    // Seasonal priority mapping
    const seasonOrder = { autumn: 1, spring: 2, summer: 3 };
    function getSeasonPriority(termName) {
      if (!termName) return 99;
      const lowerName = termName.toLowerCase();
      if (lowerName.includes("autumn")) return seasonOrder.autumn;
      if (lowerName.includes("spring")) return seasonOrder.spring;
      if (lowerName.includes("summer")) return seasonOrder.summer;
      return 99; // other terms come last
    }

    // Sort parsed terms by season first, then createdAt DESC
    const sortedParsedTerms = parsedTerms.sort((a, b) => {
      const aPriority = getSeasonPriority(a.termName);
      const bPriority = getSeasonPriority(b.termName);

      if (aPriority !== bPriority) return aPriority - bPriority;

      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Fetch Session Plan Groups
    const sessionPlanGroups = await SessionPlanGroup.findAll({
      where: { id: { [Op.in]: [...new Set(allSessionPlanIds)] } },
      attributes: ["id", "groupName", "levels", "beginner_video",
        "intermediate_video",
        "pro_video",
        "advanced_video", "banner", "player", "type", "pinned"],
      raw: true,
    });

    // Parse levels and collect exercise IDs
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

      sessionPlanMap[spg.id] = { ...spg, levels }; // store parsed levels
    });

    // Fetch session exercises
    const sessionExercises = await SessionExercise.findAll({
      where: { id: { [Op.in]: Array.from(allExerciseIds) } },
      raw: true,
    });

    const exerciseMap = {};
    sessionExercises.forEach((ex) => {
      exerciseMap[ex.id] = ex;
    });

    // Inject sessionExercises into levels
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

    // Construct final enriched response (omit _parsed fields)
    const enrichedTerms = sortedParsedTerms.map(
      ({ _parsedSessions, _parsedExclusionDates, ...rest }) => ({
        ...rest,
        exclusionDates: _parsedExclusionDates,
        sessionsMap: Array.isArray(_parsedSessions)
          ? _parsedSessions.map((s) => ({
            sessionDate: s.sessionDate,
            sessionPlanId: s.sessionPlanId,
            sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
          }))
          : [], // fallback empty array if not valid
      })
    );

    return { status: true, data: enrichedTerms };
  } catch (error) {
    return { status: false, message: error.message };
  }
};

// ✅ GET TERM BY ID (by admin)
exports.getTermById = async (id, adminId) => {
  try {
    const term = await Term.findOne({
      where: { id, createdBy: adminId },
      include: [
        {
          model: TermGroup,
          as: "termGroup",
          attributes: ["id", "name", "createdAt", "createdBy"],
        },
      ],
    });

    if (!term) {
      return { status: false, message: "Term not found or unauthorized." };
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

    // Parse exclusionDates
    let exclusions = [];
    try {
      exclusions =
        typeof term.exclusionDates === "string"
          ? JSON.parse(term.exclusionDates)
          : term.exclusionDates || [];
    } catch (err) {
      console.warn("Invalid exclusionDates format:", err);
    }

    // Collect sessionPlanIds
    const sessionPlanIds = [...new Set(sessions.map((s) => s.sessionPlanId))];

    // Fetch session plan groups
    const sessionPlanGroups = await SessionPlanGroup.findAll({
      where: { id: { [Op.in]: sessionPlanIds } },
      attributes: ["id", "groupName", "levels", "beginner_video",
        "intermediate_video",
        "pro_video",
        "advanced_video", "banner", "player", "type", "pinned"],
      raw: true,
    });

    const sessionPlanMap = {};
    const allExerciseIds = new Set();

    // Parse levels and collect exercise IDs
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
    const sessionExercises = await SessionExercise.findAll({
      where: { id: { [Op.in]: Array.from(allExerciseIds) } },
      raw: true,
    });

    const exerciseMap = {};
    sessionExercises.forEach((ex) => {
      exerciseMap[ex.id] = ex;
    });

    // Enrich levels with exercises
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

    // Enrich sessionsMap with sessionPlan details
    const enrichedSessions = sessions.map((s) => ({
      sessionDate: s.sessionDate,
      sessionPlanId: s.sessionPlanId,
      sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
    }));

    // Final output (without any parsed fields)
    return {
      status: true,
      data: {
        ...term.toJSON(),
        sessionsMap: enrichedSessions,
        exclusionDates: exclusions,
      },
    };
  } catch (error) {
    return { status: false, message: error.message };
  }
};

// ✅ GET TERMS BY TERM GROUP ID
exports.getTermsByTermGroupId = async (termGroupIds) => {
  try {
    // 🧩 Validate input
    if (
      !termGroupIds ||
      !Array.isArray(termGroupIds) ||
      termGroupIds.length === 0
    ) {
      return {
        status: false,
        message: "No valid term group IDs provided.",
        data: [],
      };
    }

    const terms = await Term.findAll({
      where: { termGroupId: { [Op.in]: termGroupIds } },
      include: [
        {
          model: TermGroup,
          as: "termGroup",
          attributes: ["id", "name", "createdAt", "createdBy"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const allSessionPlanIds = [];
    const parsedTerms = terms.map((term) => {
      let sessions = [];
      let exclusions = [];

      // Parse sessionsMap
      try {
        sessions =
          typeof term.sessionsMap === "string"
            ? JSON.parse(term.sessionsMap)
            : term.sessionsMap;
        if (Array.isArray(sessions)) {
          allSessionPlanIds.push(...sessions.map((s) => s.sessionPlanId));
        }
      } catch (err) {
        console.warn("Invalid sessionsMap:", err);
      }

      // Parse exclusionDates
      try {
        exclusions =
          typeof term.exclusionDates === "string"
            ? JSON.parse(term.exclusionDates)
            : term.exclusionDates;
      } catch (err) {
        console.warn("Invalid exclusionDates:", err);
      }

      return {
        ...term.toJSON(),
        _parsedSessions: sessions,
        _parsedExclusionDates: exclusions,
      };
    });

    // Seasonal priority mapping
    const seasonOrder = { autumn: 1, spring: 2, summer: 3 };
    function getSeasonPriority(termName) {
      if (!termName) return 99;
      const lowerName = termName.toLowerCase();
      if (lowerName.includes("autumn")) return seasonOrder.autumn;
      if (lowerName.includes("spring")) return seasonOrder.spring;
      if (lowerName.includes("summer")) return seasonOrder.summer;
      return 99; // other terms come last
    }

    // Sort parsed terms by season first, then createdAt DESC
    const sortedParsedTerms = parsedTerms.sort((a, b) => {
      const aPriority = getSeasonPriority(a.termName);
      const bPriority = getSeasonPriority(b.termName);

      if (aPriority !== bPriority) return aPriority - bPriority;

      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Fetch Session Plan Groups
    const sessionPlanGroups = await SessionPlanGroup.findAll({
      where: { id: { [Op.in]: [...new Set(allSessionPlanIds)] } },
      attributes: ["id", "groupName", "levels", "beginner_video",
        "intermediate_video",
        "pro_video",
        "advanced_video", "banner", "player", "type", "pinned"],
      raw: true,
    });

    // Parse levels and collect exercise IDs
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

      sessionPlanMap[spg.id] = { ...spg, levels }; // store parsed levels
    });

    // Fetch session exercises
    const sessionExercises = await SessionExercise.findAll({
      where: { id: { [Op.in]: Array.from(allExerciseIds) } },
      raw: true,
    });

    const exerciseMap = {};
    sessionExercises.forEach((ex) => {
      exerciseMap[ex.id] = ex;
    });

    // Inject sessionExercises into levels
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

    // Construct final enriched response (omit _parsed fields)
    const enrichedTerms = sortedParsedTerms.map(
      ({ _parsedSessions, _parsedExclusionDates, ...rest }) => ({
        ...rest,
        exclusionDates: _parsedExclusionDates,
        sessionsMap: Array.isArray(_parsedSessions)
          ? _parsedSessions.map((s) => ({
            sessionDate: s.sessionDate,
            sessionPlanId: s.sessionPlanId,
            sessionPlan: sessionPlanMap[s.sessionPlanId] || null,
          }))
          : [], // fallback empty array if not valid
      })
    );

    return { status: true, data: enrichedTerms };
  } catch (error) {
    return { status: false, message: error.message };
  }
};

// ✅ UPDATE
// exports.updateTerm = async (id, data, adminId) => {
//   try {
//     const term = await Term.findOne({ where: { id, createdBy: adminId } });
//     if (!term)
//       return { status: false, message: "Term not found or unauthorized." };

//     const cleanedData = removeNullFields(data);
//     await term.update(cleanedData);
//     return { status: true, data: term.get({ plain: true }) };
//   } catch (error) {
//     return { status: false, message: error.message };
//   }
// };
exports.updateTerm = async (id, data, adminId) => {
  try {
    const term = await Term.findOne({ where: { id, createdBy: adminId } });
    if (!term) {
      return { status: false, message: "Term not found or unauthorized." };
    }

    const cleanedData = removeNullFields(data);

    // No updates?
    if (Object.keys(cleanedData).length === 0) {
      return { status: false, message: "No valid fields to update." };
    }

    // ✅ Determine start/end for validation (use updated if provided, else existing)
    const startDate = cleanedData.startDate || term.startDate;
    const endDate = cleanedData.endDate || term.endDate;

    // ✅ Validate date formats
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

    // ✅ Ensure startDate is before endDate
    if (!start.isBefore(end)) {
      return {
        status: false,
        message: "Start date must be before end date.",
      };
    }

    // ✅ Validate exclusionDates if provided
    if (
      cleanedData.exclusionDates &&
      Array.isArray(cleanedData.exclusionDates)
    ) {
      for (const date of cleanedData.exclusionDates) {
        if (!moment(date, "YYYY-MM-DD", true).isValid()) {
          return {
            status: false,
            message: `Invalid exclusion date format: ${date}. Use 'YYYY-MM-DD'.`,
          };
        }
        const exDate = moment(date);
        if (!exDate.isBetween(start, end, undefined, "[]")) {
          return {
            status: false,
            message: `Exclusion date ${date} must be between ${startDate} and ${endDate}.`,
          };
        }
      }
      // ✅ Store as array (Sequelize JSON will handle it)
      // ❌ No stringify needed if column is JSON
    }

    // ✅ sessionsMap handling
    if (cleanedData.sessionsMap && Array.isArray(cleanedData.sessionsMap)) {
      // Store as array (again, JSON column handles it)
    }

    // ✅ Perform update
    await term.update(cleanedData);

    return { status: true, data: term.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error in updateTerm service:", error);
    return { status: false, message: error.message };
  }
};

// ✅ SOFT DELETE TERM (service)
exports.deleteTerm = async (id, deletedBy) => {
  try {
    // ✅ Find the term that belongs to this admin and is not already deleted
    const term = await Term.findOne({
      where: { id, createdBy: deletedBy, deletedAt: null },
    });

    if (!term) {
      return { status: false, message: "Term not found or unauthorized." };
    }

    // // ✅ Unlink this term from its TermGroup (if any)
    // await Term.update(
    //   { termGroupId: null },
    //   { where: { id } }
    // );

    // ✅ Record who deleted it
    await term.update({ deletedBy });

    // ✅ Perform soft delete (Sequelize sets deletedAt automatically)
    await term.destroy();

    return { status: true, message: "Term deleted successfully." };
  } catch (error) {
    console.error("❌ deleteTerm Service Error:", error);
    return { status: false, message: "Delete failed. " + error.message };
  }
};
