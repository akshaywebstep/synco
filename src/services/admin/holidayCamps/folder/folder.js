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

exports.getFolderById = async (folderId) => {
    try {
        if (!folderId || isNaN(Number(folderId))) {
            return {
                status: false,
                message: "No valid folder ID found for this request.",
                data: null,
            };
        }

        const folder = await Folder.findOne({
            where: { id: Number(folderId) },
            attributes: ["id", "name", "createdBy", "createdAt", "updatedAt"],
        });

        if (!folder) {
            return {
                status: false,
                message: "Folder not found.",
                data: null,
            };
        }

        return {
            status: true,
            message: "Folder fetched successfully.",
            data: folder,
        };

    } catch (error) {
        return {
            status: false,
            message: `Unable to fetch folder. ${error.message}`,
        };
    }
};
