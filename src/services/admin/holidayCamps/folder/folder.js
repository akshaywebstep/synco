const { Folder } = require("../../../../models");
const { Op } = require("sequelize");

// ✅ Create 
exports.createFolder = async ({ name, createdBy }) => {
    try {
        const folder = await Folder.create({
            name,
            createdBy,
        });

        return {
            status: true,
            data: folder,
            message: "Folder created successfully.",
        };
    } catch (error) {
        return {
            status: false,
            message: `Unable to create folder. ${error.message}`,
        };
    }
};

exports.getAllFolders = async (adminId) => {
    try {
        if (!adminId || isNaN(Number(adminId))) {
            return {
                status: false,
                message: "No valid parent or super admin found for this request.",
                data: [],
            };
        }
        const folders = await Folder.findAll({
            where: { createdBy: Number(adminId) },
            attributes: ["id", "name"],
            order: [["createdAt", "DESC"]],
        });

        return {
            status: true,
            message: "Folders fetched successfully.",
            data: folders,
        };
    } catch (error) {
        return {
            status: false,
            message: `Unable to fetch folders. ${error.message}`,
        };
    }
};
