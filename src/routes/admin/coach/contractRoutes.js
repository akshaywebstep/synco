const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // ✅ Handles multipart/form-data

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createContract,
    getAllContracts,
} = require("../../../controllers/admin/coaches/contractController");

// Route: 
router.post(
    "/create",
    authMiddleware,
    upload.single("pdfFile"),
    permissionMiddleware("contract", "create"),
    createContract
);

router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("contract", "view-listing"),
    getAllContracts
);

module.exports = router;
