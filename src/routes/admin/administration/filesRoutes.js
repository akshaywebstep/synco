const express = require("express");
const router = express.Router();
const multer = require("multer");

// Temporary storage
const storage = multer.memoryStorage(); // or use diskStorage if you want temp files
const upload = multer({ storage }); // You can add file size limits if needed

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createFiles,
    listFoldersWithFiles,
    deleteSingleFileUrl,
    getFolderWithFilesById,
    downloadFile,
} = require("../../../controllers/admin/administration/folder/filesController");

// ➕ Upload Files
router.post(
    "/upload",
    authMiddleware,
    permissionMiddleware("file", "create"),
    upload.array("uploadFiles"), // ← field name must match your Postman key
    createFiles
);

// 📄 Get All Files
router.get(
    "/list/uploadFiles",
    authMiddleware,
    permissionMiddleware("file", "view-listing"),
    listFoldersWithFiles
);

router.get(
    "/list/uploadFiles/:id",
    authMiddleware,
    permissionMiddleware("file", "view-listing"),
    getFolderWithFilesById
);

router.delete(
    "/delete-file",
    authMiddleware,
    permissionMiddleware("file", "view-listing"),
    deleteSingleFileUrl
);

router.get(
    "/download/:fileId",
    authMiddleware,
    permissionMiddleware("file", "view-listing"),
    downloadFile
);

module.exports = router;
