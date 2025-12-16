const { Folder, Files } = require("../../../../models");
const { Op } = require("sequelize");

// ✅ Upload multiple files
exports.createFile = async ({ uploadFiles, folder_id, createdBy }) => {
    try {
        // Ensure uploadFiles is array
        if (!Array.isArray(uploadFiles)) {
            return {
                status: false,
                message: "uploadFiles must be an array of URLs.",
            };
        }

        const file = await Files.create({
            folder_id,
            uploadFiles,  // JSON array saved directly in DB
            createdBy,
        });

        return {
            status: true,
            data: file,
            message: "Files uploaded successfully.",
        };
    } catch (error) {
        return {
            status: false,
            message: `Unable to upload files. ${error.message}`,
        };
    }
};

exports.listFiles = async ({ page = 1, limit = 20, folder_id, createdBy }) => {
    try {
        const offset = (page - 1) * limit;

        let where = {};
        if (folder_id) where.folder_id = folder_id;
        if (createdBy) where.createdBy = createdBy;

        const { count, rows } = await Files.findAndCountAll({
            where,
            include: [
                {
                    model: Folder,
                    as: "folder",
                    attributes: ["id", "name"],
                },
            ],
            order: [["createdAt", "DESC"]],
            limit,
            offset,
        });

        const files = rows.map(file => {
            let uploadFiles = [];
            try {
                uploadFiles = Array.isArray(file.uploadFiles)
                    ? file.uploadFiles
                    : JSON.parse(file.uploadFiles || "[]");
            } catch {
                uploadFiles = [];
            }

            return {
                id: file.id,
                folder_id: file.folder_id,
                createdBy: file.createdBy,
                deletedAt: file.deletedAt,
                deletedBy: file.deletedBy,
                createdAt: file.createdAt,
                updatedAt: file.updatedAt,
                uploadFiles: uploadFiles.map(url => ({ url }))  // wrap once
            };
        });

        return {
            status: true,
            data: files,
            meta: {
                total: count,
                page,
                limit,
                totalPages: Math.ceil(count / limit),
            },
        };
    } catch (error) {
        return {
            status: false,
            message: `Unable to fetch files. ${error.message}`,
        };
    }
};

exports.deleteSingleFileUrl = async ({ file_id, urlToDelete, deletedBy }) => {
    try {
        const file = await Files.findByPk(file_id);

        if (!file) {
            return { status: false, message: "File record not found." };
        }

        // Parse uploadFiles array
        let uploadFiles = [];
        try {
            uploadFiles = Array.isArray(file.uploadFiles)
                ? file.uploadFiles
                : JSON.parse(file.uploadFiles || "[]");
        } catch {
            uploadFiles = [];
        }

        // Check if URL exists
        const exists = uploadFiles.includes(urlToDelete);
        if (!exists) {
            return { status: false, message: "URL not found in uploadFiles." };
        }

        // Remove only that URL
        const updatedUploads = uploadFiles.filter(u => u !== urlToDelete);

        // If after deleting → array becomes empty → delete whole row
        if (updatedUploads.length === 0) {
            await file.destroy();
            return {
                status: true,
                message: "File removed and file record deleted (no files left)."
            };
        }

        // Update DB
        await file.update({
            uploadFiles: updatedUploads,
            deletedBy
        });

        return {
            status: true,
            message: "File deleted successfully.",
            data: file
        };

    } catch (error) {
        return {
            status: false,
            message: `Unable to delete URL. ${error.message}`
        };
    }
};

exports.downloadFileById = async (fileId) => {
    try {
        if (!fileId || isNaN(Number(fileId))) {
            return {
                status: false,
                message: "No valid file ID found for this request.",
                data: null,
            };
        }

        const file = await Files.findOne({
            where: { id: Number(fileId) },
            attributes: ["id", "uploadFiles", "createdAt"],
        });

        if (!file) {
            return {
                status: false,
                message: "File not found.",
                data: null,
            };
        }

        let uploadFiles = file.uploadFiles;

        // FIX: uploadFiles is stored as a STRING → parse it
        if (typeof uploadFiles === "string") {
            uploadFiles = JSON.parse(uploadFiles);
        }

        if (!uploadFiles || uploadFiles.length === 0) {
            return {
                status: false,
                message: "No uploaded file found for this entry.",
                data: null,
            };
        }

        return {
            status: true,
            message: "File fetched successfully.",
            data: {
                id: file.id,
                fileUrl: uploadFiles[0],     // first file
                createdAt: file.createdAt,
            },
        };

    } catch (error) {
        return {
            status: false,
            message: `Unable to fetch file. ${error.message}`,
        };
    }
};
