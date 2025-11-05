const {
  SessionPlanGroup,
  SessionExercise,
  Admin,
} = require("../../../../models");
const { deleteFile } = require("../../../../utils/fileHandler");
const path = require("path");
const { Readable } = require("stream");
const fetch = require("node-fetch");
const { Op } = require("sequelize");
function safeParseLevels(levelsRaw) {
  if (!levelsRaw) return {};
  let parsed = levelsRaw;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }

  return parsed;
}

exports.createSessionPlanGroup = async (data) => {
  try {
    const created = await SessionPlanGroup.create(data);
    return { status: true, data: created.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getSessionPlanConfigById = async (id, adminId, superAdminId) => {
  try {
    console.log(
      "🟢 Fetching SessionPlanGroup by ID:",
      id,
      "for adminId:",
      adminId
    );

    // STEP 1 — Build where condition (support both admin + super admin)
    const whereCondition = {
      id,
      type: "one_to_one",
    };

    // 🧠 Access rules
    if (superAdminId && superAdminId === adminId) {
      // Super Admin → can see all
      console.log("🟢 Super Admin detected — full access");
    } else if (superAdminId && adminId) {
      // Admin → can see own + super admin data
      whereCondition.createdBy = [adminId, superAdminId];
    } else {
      // Fallback → own only
      whereCondition.createdBy = adminId;
    }

    // STEP 2 — Fetch group
    const group = await SessionPlanGroup.findOne({
      where: whereCondition,
      attributes: [
        "id",
        "groupName",
        "type",
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
      console.warn(`⚠️ Session Plan Group not found for ID: ${id}`);
      return {
        status: false,
        message: "Session Plan Group not found or not of type 'one_to_one'.",
      };
    }

    console.log("🟢 Found group:", group.toJSON());

    // STEP 3 — Parse levels JSON safely
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

    // STEP 4 — Fetch exercises created by admin or super admin
    const exerciseWhere =
      superAdminId && adminId
        ? { createdBy: [adminId, superAdminId] }
        : { createdBy: adminId };

    const exercises = await SessionExercise.findAll({ where: exerciseWhere });
    console.log(`🟢 Fetched ${exercises.length} exercises`);

    // STEP 5 — Create quick lookup map for exercises
    const exerciseMap = exercises.reduce((acc, item) => {
      acc[item.id] = item.toJSON();
      return acc;
    }, {});

    // STEP 6 — Enrich each level with exercise details
    Object.keys(parsedLevels).forEach((levelKey) => {
      let levelArray = parsedLevels[levelKey];
      if (!Array.isArray(levelArray))
        levelArray = levelArray ? [levelArray] : [];

      parsedLevels[levelKey] = levelArray.map((entry) => {
        const ids = Array.isArray(entry.sessionExerciseId)
          ? entry.sessionExerciseId
          : [];
        const sessionExercises = ids
          .map((id) => exerciseMap[id])
          .filter(Boolean);

        return { ...entry, sessionExercises };
      });
    });

    // ✅ STEP 7 — Return identical structure
    return {
      status: true,
      data: {
        ...group.toJSON(),
        levels: parsedLevels,
      },
    };
  } catch (error) {
    console.error("❌ Error fetching Session Plan Group:", error);
    return { status: false, message: error.message };
  }
};

exports.getAllSessionPlanConfig = async ({
  order = "ASC",
  adminId,
  superAdminId,
} = {}) => {
  try {
    console.log(
      "🟢 Fetching one_to_one SessionPlanGroups for adminId:",
      adminId
    );

    // 🔹 Determine what data to fetch
    let whereCondition = { type: "one_to_one" };

    if (superAdminId === adminId) {
      // ✅ Super Admin → all admins under them (including self)
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId); // include the super admin

      whereCondition.createdBy = { [Op.in]: adminIds };
      console.log("🟢 Super Admin detected — fetching all related SessionPlanGroups");
    } else {
      // ✅ Normal Admin → only their own + super admin data
      whereCondition.createdBy = { [Op.in]: [adminId, superAdminId] };
      console.log("🟠 Admin detected — fetching own and Super Admin SessionPlanGroups");
    }

    // STEP 1 — Fetch all session plan groups
    const groups = await SessionPlanGroup.findAll({
      where: whereCondition,
      order: [
        ["pinned", "DESC"],
        ["createdAt", order.toUpperCase() === "DESC" ? "DESC" : "ASC"],
      ],
      attributes: [
        "id",
        "groupName",
        "type",
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
        "pinned",
        "createdBy",
        "createdAt",
        "updatedAt",
      ],
    });

    console.log(`🟢 Fetched ${groups.length} one_to_one SessionPlanGroups`);

    if (!groups.length) {
      return {
        status: true,
        data: { groups: [], exerciseMap: {} },
      };
    }

    // STEP 2 — Fetch exercises
    const sessionExercises = await SessionExercise.findAll({
      where: whereCondition.createdBy
        ? { createdBy: whereCondition.createdBy }
        : {},
    });
    console.log(`🟢 Fetched ${sessionExercises.length} exercises`);

    // STEP 3 — Create exercise map
    const exerciseMap = sessionExercises.reduce((acc, exercise) => {
      acc[exercise.id] = exercise.toJSON();
      return acc;
    }, {});
    console.log("🟢 Created exerciseMap keys:", Object.keys(exerciseMap));

    // STEP 4 — Parse levels and enrich with exercise data
    const parsedGroups = groups.map((group) => {
      let parsedLevels = {};
      try {
        parsedLevels =
          typeof group.levels === "string"
            ? JSON.parse(group.levels)
            : group.levels || {};
      } catch (err) {
        console.warn(
          `⚠️ Failed to parse levels for group ID ${group.id}:`,
          err.message
        );
        parsedLevels = {};
      }

      Object.keys(parsedLevels).forEach((levelKey) => {
        let levelArray = parsedLevels[levelKey];
        if (!Array.isArray(levelArray))
          levelArray = levelArray ? [levelArray] : [];

        parsedLevels[levelKey] = levelArray.map((entry) => {
          const ids = Array.isArray(entry.sessionExerciseId)
            ? entry.sessionExerciseId
            : [];
          const sessionExercises = ids
            .map((id) => exerciseMap[id])
            .filter(Boolean);
          return { ...entry, sessionExercises };
        });
      });

      return { ...group.toJSON(), levels: parsedLevels };
    });

    console.log("🟢 Parsed and enriched all levels for one_to_one groups");

    // ✅ Final response
    return {
      status: true,
      data: {
        groups: parsedGroups,
        exerciseMap,
      },
    };
  } catch (error) {
    console.error("❌ Error fetching one_to_one SessionPlanGroups:", error);
    return { status: false, message: error.message };
  }
};

exports.repinSessionPlanGroupService = async (id, createdBy, pinned) => {
  const t = await SessionPlanGroup.sequelize.transaction();

  try {
    // 🔹 Fetch admin info
    const admin = await Admin.findOne({
      where: { id: createdBy },
      attributes: ["id", "superAdminId"],
      transaction: t,
    });

    if (!admin) {
      await t.rollback();
      return { status: false, message: "Admin not found or unauthorized." };
    }

    const adminId = admin.id;
    const superAdminId = admin.superAdminId; // null for Super Admin

    let whereCondition = { id };

    if (!superAdminId) {
      // ✅ SUPER ADMIN
      // Can repin any group created by themselves or their managed admins
      const managedAdmins = await Admin.findAll({
        where: { superAdminId: adminId },
        attributes: ["id"],
        transaction: t,
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(adminId); // include Super Admin’s own ID

      whereCondition.createdBy = { [Op.in]: adminIds };
      console.log("🟢 Super Admin detected — can repin own and managed admins’ SessionPlanGroups");
    } else {
      // ✅ NORMAL ADMIN
      // Can repin only their own and Super Admin’s groups
      whereCondition.createdBy = { [Op.in]: [adminId, superAdminId] };
      console.log("🟠 Normal Admin detected — can repin own and Super Admin’s SessionPlanGroups");
    }

    // 🔹 Find the specific group by ID and valid creator
    const targetGroup = await SessionPlanGroup.findOne({
      where: whereCondition,
      transaction: t,
    });

    if (!targetGroup) {
      await t.rollback();
      return { status: false, message: "Group not found or unauthorized." };
    }

    // 🔹 Update pinned status
    await targetGroup.update(
      { pinned: pinned === 1 || pinned === true },
      { transaction: t }
    );

    await t.commit();

    return {
      status: true,
      message: pinned
        ? "Group pinned successfully."
        : "Group unpinned successfully.",
      data: {
        id: targetGroup.id,
        pinned: pinned ? 1 : 0,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ Error repinning session plan group (service):", error);
    return {
      status: false,
      message: error.message || "Failed to repin/unpin session plan group.",
    };
  }
};

exports.getSessionPlanConfigVideoStream = async (
  id,
  createdBy,
  level,
  filename
) => {
  try {
    // ✅ Step 1: Validate level
    const validLevels = ["beginner", "intermediate", "advanced", "pro"];
    if (!validLevels.includes(level)) {
      return {
        status: false,
        message: `Invalid level '${level}'. Must be one of: ${validLevels.join(
          ", "
        )}.`,
      };
    }

    const videoField = `${level}_video`; // e.g. beginner_video

    // ✅ Step 2: Fetch from DB
    const group = await SessionPlanGroup.findOne({
      where: { id, createdBy },
      attributes: ["id", "groupName", videoField],
    });

    if (!group) {
      return { status: false, message: "Session Plan Group not found." };
    }

    const videoUrl = group[videoField];
    if (!videoUrl) {
      return { status: false, message: `No ${level} video found.` };
    }

    // ✅ Step 3: Fetch the video file
    const response = await fetch(videoUrl);
    if (!response.ok) {
      return { status: false, message: `Failed to fetch ${level} video.` };
    }

    // ✅ Step 4: Convert to Node.js-readable stream
    const nodeStream =
      typeof response.body.pipe === "function"
        ? response.body
        : Readable.fromWeb(response.body);

    // ✅ Step 5: Determine filename
    const safeGroupName = (group.groupName || "session").replace(/\s+/g, "_");
    const finalFileName = filename || `${safeGroupName}_${level}.mp4`;

    // ✅ Step 6: Return
    return { status: true, stream: nodeStream, filename: finalFileName };
  } catch (error) {
    console.error("❌ Error fetching session plan config video:", error);
    return { status: false, message: error.message };
  }
};

exports.updateSessionPlanConfig = async (id, updatePayload, createdBy) => {
  try {
    // STEP 1 — Find the session plan group by ID and createdBy
    const sessionGroup = await SessionPlanGroup.findOne({
      where: { id, createdBy },
    });

    if (!sessionGroup) {
      return { status: false, message: "Session Plan Group not found." };
    }

    // STEP 2 — Update the record
    await sessionGroup.update(updatePayload);

    // STEP 3 — Return the updated data
    return {
      status: true,
      message: "Session Plan Group updated successfully.",
      data: sessionGroup,
    };
  } catch (error) {
    console.error("❌ Error updating Session Plan Group:", error);
    return { status: false, message: "Internal server error." };
  }
};

exports.deleteSessionPlanConfig = async (id, deletedBy) => {
  try {
    // ✅ Find group by ID (paranoid-enabled model)
    const group = await SessionPlanGroup.findOne({
      where: { id },
    });

    if (!group) {
      return { status: false, message: "Session Plan Group not found" };
    }

    // ✅ Set deletedBy before soft delete
    await group.update({ deletedBy });

    // ✅ Soft delete (sets deletedAt)
    await group.destroy();

    return { status: true, message: "Session Plan Group deleted successfully" };
  } catch (error) {
    console.error("❌ Delete Error:", error);
    return { status: false, message: error.message };
  }
};

exports.deleteLevelFromSessionPlanConfig = async (id, levelKey, createdBy) => {
  try {
    const sessionGroup = await SessionPlanGroup.findOne({
      where: { id, createdBy },
      raw: true,
    });

    if (!sessionGroup) {
      return { status: false, message: "Session Plan Group not found." };
    }

    const existingLevels = safeParseLevels(sessionGroup.levels);
    const normalizedKey = levelKey.toLowerCase();
    const matchedKey = Object.keys(existingLevels).find(
      (k) => k.toLowerCase() === normalizedKey
    );

    if (!matchedKey) {
      return {
        status: false,
        message: `Level '${levelKey}' not found in this group.`,
      };
    }

    delete existingLevels[matchedKey];

    const bannerField = `${normalizedKey}_banner`;
    const videoField = `${normalizedKey}_video`;

    const updatePayload = {
      levels: existingLevels,
      [bannerField]: null,
      [videoField]: null,
    };

    if (sessionGroup[bannerField]) {
      const bannerPath = path.join(process.cwd(), sessionGroup[bannerField]);
      await deleteFile(bannerPath);
    }
    if (sessionGroup[videoField]) {
      const videoPath = path.join(process.cwd(), sessionGroup[videoField]);
      await deleteFile(videoPath);
    }

    const result = await exports.updateSessionPlanConfig(
      id,
      updatePayload,
      createdBy
    );

    if (!result.status) return result;

    return {
      status: true,
      message: `Level '${matchedKey}' removed successfully`,
      data: result.data,
    };
  } catch (error) {
    console.error("❌ Service delete level error:", error);
    return { status: false, message: "Internal server error" };
  }
};

exports.repinSessionPlanGroup = async (id, createdBy, pinned) => {
  const t = await SessionPlanGroup.sequelize.transaction();

  try {
    const targetGroup = await SessionPlanGroup.findOne({
      where: { id, createdBy },
      transaction: t,
    });
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
      message:
        pinned === 1
          ? "Group pinned successfully."
          : "Group unpinned successfully.",
      data: {
        id: targetGroup.id,
        pinned,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ Error repinning session plan group:", error);
    return {
      status: false,
      message: error.message || "Failed to repin session plan group.",
    };
  }
};
