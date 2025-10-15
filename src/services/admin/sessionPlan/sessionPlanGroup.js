const { SessionPlanGroup, SessionExercise } = require("../../../models");
const { deleteFile } = require("../../../utils/fileHandler");
const path = require("path");
const { Readable } = require("stream");
const fetch = require("node-fetch");

// Service
// exports.duplicateSessionPlanGroup = async (id, createdBy) => {
//   try {
//     // 1️⃣ Find the original group
//     const group = await SessionPlanGroup.findOne({ where: { id, createdBy } });
//     if (!group) return { status: false, message: "Session Plan Group not found" };

//     // 2️⃣ Parse levels if stored as string
//     let parsedLevels = {};
//     try {
//       parsedLevels =
//         typeof group.levels === "string" ? JSON.parse(group.levels) : group.levels || {};
//     } catch {
//       parsedLevels = {};
//     }

//     // 3️⃣ Clone data
//     const newGroupData = {
//       groupName: group.groupName,
//       banner: group.banner,
//       video: group.video,
//       player: group.player,
//       levels: parsedLevels, // store as object if DB supports JSON
//       beginner_upload: group.beginner_upload,
//       intermediate_upload: group.intermediate_upload,
//       pro_upload: group.pro_upload,
//       advanced_upload: group.advanced_upload,
//       createdBy,
//     };
//     // 4️⃣ Create the new group
//     const newGroup = await SessionPlanGroup.create(newGroupData);

//     return { status: true, data: newGroup };
//   } catch (error) {
//     console.error("❌ Error duplicating Session Plan Group:", error);
//     return { status: false, message: error.message };
//   }
// };

exports.duplicateSessionPlanGroup = async (id, createdBy) => {
  try {
    // 1️⃣ Find the original group
    const group = await SessionPlanGroup.findOne({ where: { id, createdBy } });
    if (!group) return { status: false, message: "Session Plan Group not found" };

    // 2️⃣ Parse levels if stored as string
    let parsedLevels = {};
    try {
      parsedLevels =
        typeof group.levels === "string" ? JSON.parse(group.levels) : group.levels || {};
    } catch {
      parsedLevels = {};
    }

    // 3️⃣ Clone data (✅ include level-wise videos too)
    const newGroupData = {
      groupName: group.groupName,
      banner: group.banner,
      player: group.player,
      levels: parsedLevels, // store as object if DB supports JSON

      // ✅ Level-wise videos
      beginner_video: group.beginner_video,
      intermediate_video: group.intermediate_video,
      advanced_video: group.advanced_video,
      pro_video: group.pro_video,

      // ✅ Level-wise uploads
      beginner_upload: group.beginner_upload,
      intermediate_upload: group.intermediate_upload,
      advanced_upload: group.advanced_upload,
      pro_upload: group.pro_upload,

      createdBy,
    };

    // 4️⃣ Create the new group
    const newGroup = await SessionPlanGroup.create(newGroupData);

    return { status: true, data: newGroup };
  } catch (error) {
    console.error("❌ Error duplicating Session Plan Group:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Create
exports.createSessionPlanGroup = async (data) => {
  try {
    const created = await SessionPlanGroup.create(data);
    return { status: true, data: created.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getAllSessionPlanGroups = async ({
  orderBy = "createdAt",
  order = "DESC",
  createdBy,
} = {}) => {
  try {
    const groups = await SessionPlanGroup.findAll({
      where: { createdBy },
      order: [[orderBy, order]],
      attributes: [
        "id",
        "groupName",
        "sortOrder",
        "banner",
        // "pinned",
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

    const sessionExercises = await SessionExercise.findAll({
      where: { createdBy },
    });

    const exerciseMap = sessionExercises.reduce((acc, exercise) => {
      acc[exercise.id] = exercise.toJSON();
      return acc;
    }, {});

    const parsedGroups = groups.map((group) => {
      let parsedLevels;
      try {
        parsedLevels =
          typeof group.levels === "string"
            ? JSON.parse(group.levels)
            : group.levels || {};
      } catch (err) {
        console.error(
          `⚠️ Failed to parse levels for group ID ${group.id}`,
          err
        );
        parsedLevels = {};
      }

      return {
        ...group.toJSON(),
        levels: parsedLevels,
      };
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

exports.getSessionPlanGroupById = async (id, createdBy) => {
  try {
    const group = await SessionPlanGroup.findOne({
      where: { id, createdBy },
      attributes: [
        "id",
        "groupName",
        "banner",
        // "pinned",
        // "video",
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
      return { status: false, message: "Session Plan Group not found" };
    }

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

    // ✅ Get all session exercises created by this admin
    const exercises = await SessionExercise.findAll({
      where: { createdBy },
    });

    const exerciseMap = exercises.reduce((acc, item) => {
      acc[item.id] = item.toJSON();
      return acc;
    }, {});

    // ✅ Enrich each level with full exercise data
    Object.keys(parsedLevels).forEach((levelKey) => {
      let levelArray = parsedLevels[levelKey];

      if (!Array.isArray(levelArray)) {
        levelArray = levelArray ? [levelArray] : [];
      }

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

exports.getSessionPlanGroupVideoStream = async (id, createdBy, filename) => {
  try {
    // Fetch the group from DB
    const group = await SessionPlanGroup.findOne({
      where: { id, createdBy },
      attributes: ["id", "groupName", "video"],
    });

    if (!group || !group.video) {
      return { status: false, message: "Video not found" };
    }

    // Fetch the video URL
    const response = await fetch(group.video);
    if (!response.ok) {
      return { status: false, message: `Failed to fetch video` };
    }

    // Node.js stream
    const nodeStream =
      typeof response.body.pipe === "function"
        ? response.body
        : Readable.fromWeb(response.body);

    // Determine download filename
    const finalFileName =
      filename || // query parameter
      (group.groupName
        ? `${group.groupName.replace(/\s+/g, "_")}.mp4`
        : path.basename(group.video));

    return { status: true, stream: nodeStream, filename: finalFileName };
  } catch (error) {
    console.error("❌ Error fetching group video:", error);
    return { status: false, message: error.message };
  }
};

exports.updateSessionPlanGroup = async (id, updatePayload, createdBy) => {
  try {
    const sessionGroup = await SessionPlanGroup.findOne({
      where: { id, createdBy },
    });

    if (!sessionGroup) {
      return { status: false, message: "Session Plan Group not found." };
    }
    await sessionGroup.update(updatePayload);

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

exports.deleteSessionPlanGroup = async (id, deletedBy) => {
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

// Delete level from group
exports.deleteLevelFromSessionPlanGroup = async (id, levelKey, createdBy) => {
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

    const result = await exports.updateSessionPlanGroup(
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

exports.reorderSessionPlanGroups = async (orderedIds = [], createdBy) => {
  try {
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      await SessionPlanGroup.update(
        { sortOrder: index + 1 },
        { where: { id, createdBy } }
      );
    }

    const updatedGroups = await SessionPlanGroup.findAll({
      where: { createdBy },
      order: [["sortOrder", "ASC"]],
      attributes: ["id", "groupName", "sortOrder"],
    });

    return {
      status: true,
      message: "Session plan groups reordered successfully",
      data: updatedGroups,
    };
  } catch (error) {
    console.error("❌ reorderSessionPlanGroups service error:", error);
    return { status: false, message: "Internal server error" };
  }
};

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
