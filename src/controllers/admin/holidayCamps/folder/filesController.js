const path = require("path");
const fs = require("fs");
const { validateFormData } = require("../../../../utils/validateFormData");
const FilesService = require("../../../../services/admin/holidayCamps/folder/files");
const FolderService = require("../../../../services/admin/holidayCamps/folder/folder");

const { logActivity } = require("../../../../utils/admin/activityLogger");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");
const { createNotification } = require("../../../../utils/admin/notificationHelper");
const { saveFile } = require("../../../../utils/fileHandler");
const { uploadToFTP } = require("../../../../utils/uploadToFTP");

const axios = require("axios");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "folder";

async function getFileSizeFromUrl(url) {
    try {
        const headRes = await axios.head(url);
        if (headRes.headers["content-length"]) {
            return parseInt(headRes.headers["content-length"]);
        }
    } catch { }

    // fallback if HEAD not supported
    try {
        const getRes = await axios.get(url, { method: "GET", responseType: "stream" });
        if (getRes.headers["content-length"]) {
            return parseInt(getRes.headers["content-length"]);
        }
    } catch { }

    return 0;
}

// ------------------------------------------------------
// ✅ MULTIPLE FILE UPLOAD CONTROLLER
// ------------------------------------------------------
exports.createFiles = async (req, res) => {

    const formData = req.body || {};
    const files = req.files || [];

    const { folder_id } = formData;

    if (!folder_id) {
        return res.status(400).json({ status: false, message: "folder_id is required" });
    }

    if (DEBUG) {
        console.log("📥 Incoming file upload request");
        console.log("📝 Form Data:", formData);
        console.log("📦 Files Received:", files.length);
    }

    // Step 1: Validate required fields
    const validation = validateFormData(formData, {
        requiredFields: ["folder_id"],
    });

    if (!validation.isValid) {
        await logActivity(req, PANEL, MODULE, "create", validation.error, false);
        return res.status(400).json({
            status: false,
            error: validation.error,
            message: validation.message,
        });
    }

    // Step 2: Validate file extensions
    const allowedExtensions = {
        images: ["jpg", "jpeg", "png", "webp", "svg", "gif", "bmp", "tiff"],
        documents: ["pdf", "doc", "docx", "txt", "rtf", "odt"],
        spreadsheets: ["xls", "xlsx", "csv", "ods"],
        presentations: ["ppt", "pptx", "odp"],
        archives: ["zip", "rar", "7z", "tar", "gz"],
        audio: ["mp3", "wav", "aac", "m4a", "ogg"],
        video: ["mp4", "mov", "avi", "mkv", "wmv"],
        code: ["json", "xml", "yaml", "yml"],
        design: ["psd", "ai", "eps"]
    };

    const allAllowedExtensions = Object.values(allowedExtensions).flat();

    for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        if (!allAllowedExtensions.includes(ext)) {
            return res.status(400).json({
                status: false,
                message: `Invalid file type: ${file.originalname}`,
            });
        }
    }

    try {
        // ------------------------------------------------------
        // STEP 3: Upload files & collect URLs
        // ------------------------------------------------------
        const fileRecord = await FilesService.createFile({
            uploadFiles: [],
            folder_id,
            createdBy: req.admin.id,
        });

        const fileId = fileRecord.data.id; // use this in paths

        let uploadedURLs = [];

        for (const file of files) {
            const uniqueId = Math.floor(Math.random() * 1e9);
            const ext = path.extname(file.originalname).toLowerCase();
            const fileName = `${Date.now()}_${uniqueId}${ext}`;

            const localPath = path.join(
                process.cwd(),
                "uploads",
                "temp",
                "admin",
                `${req.admin.id}`,
                "folderFiles",
                `${fileId}`, // Use the same DB record ID
                fileName
            );

            await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

            await saveFile(file, localPath);

            const remotePath = `admin/${req.admin.id}/folderFiles/${fileId}/${fileName}`;
            const publicUrl = await uploadToFTP(localPath, remotePath);

            if (publicUrl) uploadedURLs.push(publicUrl);

            await fs.promises.unlink(localPath).catch(() => { });
        }

        // Step 2: Update the same record with URLs
        await fileRecord.data.update({ uploadFiles: uploadedURLs });

        // ------------------------------------------------------
        // STEP 4: Save in DB (JSON array)
        // ------------------------------------------------------
        const result = await FilesService.createFile({
            uploadFiles: uploadedURLs, // Array of URLs
            folder_id,
            createdBy: req.admin.id,
        });

        if (!result.status) {
            await logActivity(req, PANEL, MODULE, "create", result, false);
            return res.status(500).json({
                status: false,
                message: result.message || "Failed to upload files.",
            });
        }

        await logActivity(req, PANEL, MODULE, "create", result, true);

        return res.status(201).json({
            status: true,
            message: "Files uploaded successfully.",
            data: result.data,
        });

    } catch (error) {
        console.error("❌ File Upload Error:", error);
        await logActivity(req, PANEL, MODULE, "create", error, false);
        return res.status(500).json({
            status: false,
            message: "Server error while uploading files.",
        });
    }
};

exports.listFoldersWithFiles = async (req, res) => {
    const adminId = req.admin?.id;

    try {
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

        const foldersResult = await FolderService.getAllFolders(superAdminId);
        if (!foldersResult.status) {
            return res.status(500).json({ status: false, message: foldersResult.message });
        }

        const folders = foldersResult.data;

       const foldersWithFiles = await Promise.all(
    folders.map(async folder => {

        if (DEBUG) {
            console.log(`\n\n==============================`);
            console.log(`📁 Processing Folder ID: ${folder.id} | Name: ${folder.name}`);
            console.log(`==============================`);
        }

        const filesResult = await FilesService.listFiles({
            page: 1,
            limit: 1000,
            folder_id: folder.id
        });

        if (DEBUG) {
            console.log(`📄 FilesService.listFiles Result for folder ${folder.id}:`, filesResult);
        }

        const files = filesResult.status ? filesResult.data : [];

        if (DEBUG) {
            console.log(`📦 Total file records inside folder ${folder.id}: ${files.length}`);
        }

        // ------------------------------------------------------
        // 🟩 TOTAL FILES = number of file URLs
        // ------------------------------------------------------
        const totalFiles = files.reduce((sum, file) => {
            if (DEBUG) {
                console.log(
                    `➡️ File ID: ${file.id} has ${file.uploadFiles.length} uploaded files`
                );
            }
            return sum + file.uploadFiles.length;
        }, 0);

        if (DEBUG) {
            console.log(`📊 Total upload files count inside folder ${folder.id}: ${totalFiles}`);
        }

        // ------------------------------------------------------
        // 🟩 TOTAL SPACE USED (real URL sizes)
        // ------------------------------------------------------
        let totalBytes = 0;

        for (const file of files) {
            for (const upload of file.uploadFiles) {
                if (DEBUG) {
                    console.log(`🔗 Checking file size for URL: ${upload.url}`);
                }

                const size = await getFileSizeFromUrl(upload.url);

                if (DEBUG) {
                    console.log(`📏 Size for URL: ${upload.url} = ${size} bytes`);
                }

                totalBytes += size;
            }
        }

        if (DEBUG) {
            console.log(`📐 Total bytes for folder ${folder.id}: ${totalBytes}`);
        }

        // Convert bytes → MB
        const totalSpaceUsed = `${(totalBytes / (1024 * 1024)).toFixed(2)}mb`;

        if (DEBUG) {
            console.log(`💾 Total space used in folder ${folder.id}: ${totalSpaceUsed}`);
        }

        return {
            id: folder.id,
            name: folder.name,
            totalFiles,
            totalSpaceUsed,
            files
        };
    })
);

        return res.status(200).json({
            status: true,
            message: "Folders fetched successfully.",
            data: foldersWithFiles
        });

    } catch (error) {
        console.error("❌ List Folders With Files Error:", error);
        return res.status(500).json({
            status: false,
            message: "Server error while fetching folders with files",
        });
    }
};

exports.deleteSingleFileUrl = async (req, res) => {
    const { file_id, url } = req.body;

    if (DEBUG) {
        console.log("\n================ DELETE SINGLE FILE URL ================");
        console.log("📥 Incoming Delete Request");
        console.log("🆔 file_id:", file_id);
        console.log("🔗 url:", url);
    }

    if (!file_id || !url) {
        return res.status(400).json({
            status: false,
            message: "file_id and url are required.",
        });
    }

    try {
        const result = await FilesService.deleteSingleFileUrl({
            file_id,
            urlToDelete: url,
            deletedBy: req.admin?.id
        });

        if (DEBUG) {
            console.log("📤 Service Response:", result);
        }

        await logActivity(
            req,
            PANEL,
            MODULE,
            "deleteFileUrl",
            { file_id, url },
            result.status
        );

        return res.status(result.status ? 200 : 400).json(result);

    } catch (error) {
        console.error("❌ Delete File URL Error:", error);

        await logActivity(req, PANEL, MODULE, "deleteFileUrl", error, false);

        return res.status(500).json({
            status: false,
            message: "Server error while deleting file URL.",
        });
    }
};
