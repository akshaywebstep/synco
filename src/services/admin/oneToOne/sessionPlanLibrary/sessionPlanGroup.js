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
    console.log("🟢 Fetching SessionPlanConfig by ID:", id, "for createdBy:", createdBy);

    // STEP 1 — Fetch the SessionPlanConfig record
    const config = await SessionPlanConfig.findOne({
      where: { id, createdBy },
      attributes: ["id", "type", "pinned", "sessionPlanGroupId", "createdAt", "updatedAt"],
    });

    if (!config) {
      console.warn(`⚠️ Session Plan Config not found for ID: ${id}`);
      return { status: false, message: "Session Plan Config not found" };
    }
    console.log("🟢 Found config:", config.toJSON());

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
      console.warn(`⚠️ Session Plan Group not found for config ID: ${id}`);
      return { status: false, message: "Session Plan Group not found for this config" };
    }
    console.log("🟢 Found group:", group.toJSON());

    // STEP 3 — Parse levels JSON
    let parsedLevels = {};
    try {
      parsedLevels = typeof group.levels === "string" ? JSON.parse(group.levels) : group.levels || {};
    } catch (err) {
      console.warn("⚠️ Failed to parse levels JSON:", err.message);
      parsedLevels = {};
    }
    console.log("🟢 Parsed levels:", parsedLevels);

    // STEP 4 — Fetch exercises
    const exercises = await SessionExercise.findAll({ where: { createdBy } });
    console.log(`🟢 Fetched ${exercises.length} exercises`);

    const exerciseMap = exercises.reduce((acc, item) => {
      acc[item.id] = item.toJSON();
      return acc;
    }, {});
    console.log("🟢 Created exerciseMap keys:", Object.keys(exerciseMap));

    // STEP 5 — Enrich each level with full exercise data
    Object.keys(parsedLevels).forEach((levelKey) => {
      let levelArray = parsedLevels[levelKey];
      if (!Array.isArray(levelArray)) levelArray = levelArray ? [levelArray] : [];

      parsedLevels[levelKey] = levelArray.map((entry) => {
        const ids = Array.isArray(entry.sessionExerciseId) ? entry.sessionExerciseId : [];
        const sessionExercises = ids.map((id) => exerciseMap[id]).filter(Boolean);
        console.log(`🟢 Level '${levelKey}' enriched with ${sessionExercises.length} exercises`);
        return {
          ...entry,
          sessionExercises,
        };
      });
    });

    // ✅ Final response: attach enriched levels inside sessionPlanGroup
    return {
      status: true,
      data: {
        ...config.toJSON(),
        group: {
          ...group.toJSON(),
          levels: parsedLevels,
        },
      },
    };
  } catch (error) {
    console.error("❌ Error fetching Session Plan Config with Group:", error);
    return { status: false, message: error.message };
  }
};

exports.getAllSessionPlanConfig = async ({
  order = "ASC",
  createdBy,
} = {}) => {
  try {
    console.log("🟢 Fetching session plan configs for createdBy:", createdBy);

    // Fetch all session plan configs of type "one_to_one"
    const configs = await SessionPlanConfig.findAll({
      where: { createdBy, type: "one_to_one" },
      attributes: [
        "id",
        "sessionPlanGroupId",
        "type",
        "createdBy",
        "pinned",
        "createdAt",
        "updatedAt",
      ],
    });
    console.log(`🟢 Fetched ${configs.length} one_to_one configs`);

    if (!configs.length) {
      console.log("⚠️ No configs found for this user");
      return { status: true, data: { configs: [], groups: [], exerciseMap: {} } };
    }

    // Extract group IDs linked to the configs
    const groupIds = configs.map((config) => config.sessionPlanGroupId);
    console.log("🟢 Linked group IDs:", groupIds);

    // Fetch only groups linked to these configs
    const groups = await SessionPlanGroup.findAll({
      where: { id: groupIds },
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
    console.log(`🟢 Fetched ${groups.length} groups linked to configs`);

    // Fetch exercises
    const sessionExercises = await SessionExercise.findAll({ where: { createdBy } });
    console.log(`🟢 Fetched ${sessionExercises.length} exercises`);

    const exerciseMap = sessionExercises.reduce((acc, exercise) => {
      acc[exercise.id] = exercise.toJSON();
      return acc;
    }, {});
    console.log("🟢 Created exerciseMap with keys:", Object.keys(exerciseMap));

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
    console.log("🟢 Parsed levels for all groups");

    return {
      status: true,
      data: {
        configs,       // only "one_to_one" configs
        groups: parsedGroups, // only groups linked to the configs
        exerciseMap,
      },
    };
  } catch (error) {
    console.error("❌ Fetch Error:", error);
    return { status: false, message: error.message };
  }
};

exports.updateSessionPlanGroup = async (id, updatePayload, createdBy) => {
  try {
    const sessionConfig = await SessionPlanConfig.findOne({
      where: { id, createdBy },
    });

    if (!sessionConfig) {
      return { status: false, message: "Session Plan Group not found." };
    }
    await sessionConfig.update(updatePayload);

    return {
      status: true,
      message: "Updated successfully",
      data: sessionGroup,
    };
  } catch (error) {
    console.error("❌ Service update error:", error);
    return { status: false, message: "Internal server error" };
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
