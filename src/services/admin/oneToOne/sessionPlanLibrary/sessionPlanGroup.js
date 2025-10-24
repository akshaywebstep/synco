const { SessionPlanGroup, SessionExercise, SessionPlanConfig } = require("../../../../models");
const { deleteFile } = require("../../../../utils/fileHandler");
const path = require("path");
const { Readable } = require("stream");
const fetch = require("node-fetch");

exports.createSessionPlanGroup = async (data) => {
  try {
    const created = await SessionPlanGroup.create(data);
    return { status: true, data: created.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getSessionPlanConfigById = async (id, createdBy) => {
  try {
    // STEP 1 — Fetch the SessionPlanConfig record
    const config = await SessionPlanConfig.findOne({
      where: { id, createdBy },
      attributes: [
        "id",
        "type",
        "pinned",
        "sessionPlanGroupId",
        "createdAt",
        "updatedAt",
      ],
    });

    if (!config) {
      return { status: false, message: "Session Plan Config not found" };
    }

    // STEP 2 — Fetch the related SessionPlanGroup
    const group = await SessionPlanGroup.findOne({
      where: { id: config.sessionPlanGroupId, createdBy },
      attributes: [
        "id",
        "groupName",
        "banner",
        "beginner_video",
        "intermediate_video",
        "pro_video",
        "advanced_video",
        "player",
        "levels",
        "beginner_upload",
        "intermediate_upload",
        "pro_upload",
        "advanced_upload",
        "createdAt",
        "updatedAt",
      ],
    });

    if (!group) {
      return {
        status: false,
        message: "Session Plan Group not found for this config",
      };
    }

    // STEP 3 — Parse levels JSON
    let parsedLevels = {};
    try {
      parsedLevels =
        typeof group.levels === "string"
          ? JSON.parse(group.levels)
          : group.levels || {};
    } catch (err) {
      console.warn("⚠️ Failed to parse levels JSON:", err.message);
      parsedLevels = {};
    }

    // STEP 4 — Fetch exercises
    const exercises = await SessionExercise.findAll({
      where: { createdBy },
    });

    const exerciseMap = exercises.reduce((acc, item) => {
      acc[item.id] = item.toJSON();
      return acc;
    }, {});

    // STEP 5 — Enrich each level with full exercise data
    Object.keys(parsedLevels).forEach((levelKey) => {
      let levelArray = parsedLevels[levelKey];
      if (!Array.isArray(levelArray)) levelArray = levelArray ? [levelArray] : [];

      parsedLevels[levelKey] = levelArray.map((entry) => {
        const ids = Array.isArray(entry.sessionExerciseId)
          ? entry.sessionExerciseId
          : [];
        return {
          ...entry,
          sessionExercises: ids.map((id) => exerciseMap[id]).filter(Boolean),
        };
      });
    });

    // ✅ Final response: attach enriched levels inside sessionPlanGroup
    return {
      status: true,
      data: {
        ...config.toJSON(),
        sessionPlanGroup: {
          ...group.toJSON(),
          levels: parsedLevels, // <- Enriched exercises here
        },
      },
    };
  } catch (error) {
    console.error("❌ Error fetching Session Plan Config with Group:", error);
    return { status: false, message: error.message };
  }
};

exports.getAllSessionPlanConfig = async ({
  orderBy = "sortOrder",
  order = "ASC",
  createdBy,
  configId, // if you want to query a specific config
} = {}) => {
  try {
    // Fetch session plan config (if configId is provided)
    let config = null;
    if (configId) {
      config = await SessionPlanConfig.findOne({
        where: { id: configId, createdBy },
        attributes: [
          "id",
          "type",
          "pinned",
          "sessionPlanGroupId",
          "createdAt",
          "updatedAt",
        ],
      });

      if (!config) {
        return { status: false, message: "Session Plan Config not found" };
      }
    }

    // Fetch groups
    const groups = await SessionPlanGroup.findAll({
      where: { createdBy },
      order: [[orderBy, order.toUpperCase() === "DESC" ? "DESC" : "ASC"]],
      attributes: [
        "id",
        "groupName",
        "sortOrder",
        "banner",
        "beginner_video",
        "intermediate_video",
        "pro_video",
        "advanced_video",
        "player",
        "levels",
        "beginner_upload",
        "intermediate_upload",
        "pro_upload",
        "advanced_upload",
        // "pinned",
        "createdAt",
        "updatedAt",
      ],
    });

    // Fetch exercises
    const sessionExercises = await SessionExercise.findAll({ where: { createdBy } });

    const exerciseMap = sessionExercises.reduce((acc, exercise) => {
      acc[exercise.id] = exercise.toJSON();
      return acc;
    }, {});

    // Parse group levels
    const parsedGroups = groups.map((group) => {
      let parsedLevels = {};
      if (group.levels) {
        try {
          parsedLevels = typeof group.levels === "string" ? JSON.parse(group.levels) : group.levels;
        } catch (err) {
          console.error(`⚠️ Failed to parse levels for group ID ${group.id}`, err);
        }
      }

      return { ...group.toJSON(), levels: parsedLevels };
    });

    return {
      status: true,
      data: {
        groups: parsedGroups,
        exerciseMap,
      },
    };
  } catch (error) {
    console.error("❌ Fetch Error:", error);
    return { status: false, message: error.message };
  }
};

exports.repinSessionPlanGroup = async (id, createdBy, pinned) => {
  const t = await SessionPlanGroup.sequelize.transaction();

  try {
    const targetGroup = await SessionPlanGroup.findOne({ where: { id, createdBy }, transaction: t });
    if (!targetGroup) {
      await t.rollback();
      return { status: false, message: "Group not found or unauthorized." };
    }

    // If pinned = 1 → unpin all others, then pin this one
    if (pinned === 1) {
      await SessionPlanGroup.update(
        { pinned: false },
        { where: { createdBy, pinned: true }, transaction: t }
      );
    }

    // Update this group
    await targetGroup.update({ pinned: pinned === 1 }, { transaction: t });
    await t.commit();

    return {
      status: true,
      message: pinned === 1 ? "Group pinned successfully." : "Group unpinned successfully.",
      data: {
        id: targetGroup.id,
        pinned,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ Error repinning session plan group:", error);
    return { status: false, message: error.message || "Failed to repin session plan group." };
  }
};
