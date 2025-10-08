const { SessionPlanGroup, SessionExercise } = require("../../../../models");
const { deleteFile } = require("../../../../utils/fileHandler");
const path = require("path");
const { Readable } = require("stream");
const fetch = require("node-fetch");

exports.getAllSessionPlanGroups = async ({
    orderBy = "sortOrder",
    order = "ASC",
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

exports.repinSessionPlanGroup = async (id, createdBy) => {
  const t = await SessionPlanGroup.sequelize.transaction();

  try {
    // 1️⃣ Ensure the target group exists and belongs to the creator
    const targetGroup = await SessionPlanGroup.findOne({
      where: { id, createdBy },
      transaction: t,
    });

    if (!targetGroup) {
      await t.rollback();
      return {
        status: false,
        message: "Group not found or unauthorized.",
      };
    }

    // 2️⃣ Unpin all other groups for this user
    await SessionPlanGroup.update(
      { pinned: false },
      {
        where: { createdBy, pinned: true },
        transaction: t,
      }
    );

    // 3️⃣ Pin the selected group
    await targetGroup.update({ pinned: true }, { transaction: t });

    // 4️⃣ Commit transaction
    await t.commit();

    // 5️⃣ Return consistent structure
    return {
      status: true,
      message: "Group pinned successfully.",
      data: targetGroup.toJSON ? targetGroup.toJSON() : targetGroup,
    };
  } catch (error) {
    // Ensure transaction rollback on failure
    await t.rollback();
    console.error("❌ Error repinning session plan group:", error);

    return {
      status: false,
      message: error.message || "Failed to repin session plan group.",
    };
  }
};
