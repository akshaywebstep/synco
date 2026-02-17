const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createFolder,
    getAllFolders,
} = require("../../../controllers/admin/administration/folder/folderController");

// ➕ Create  Camp
router.post(
    "/create",
    authMiddleware,
    permissionMiddleware("folder", "create"),
    createFolder
);
router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("folder", "view-listing"),
    getAllFolders
);
module.exports = router;
