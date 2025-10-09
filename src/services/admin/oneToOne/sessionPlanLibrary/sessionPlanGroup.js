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
                "video",
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
    try {
        // 1️⃣ Unpin any currently pinned group
        await SessionPlanGroup.update(
            { pinned: false },
            { where: { pinned: true, createdBy } }
        );

        // 2️⃣ Pin the selected group
        const updatedGroup = await SessionPlanGroup.update(
            { pinned: true },
            { where: { id, createdBy }, returning: true, plain: true }
        );

        return { status: true, message: "Group pinned successfully", data: updatedGroup[1] };
    } catch (error) {
        console.error("❌ Error repinning session plan group:", error);
        return { status: false, message: error.message };
    }
};
