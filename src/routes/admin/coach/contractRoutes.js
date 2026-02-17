const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // ✅ Handles multipart/form-data

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createContract,
    getAllContracts,
    getContractById,
    updateContractById,
    downloadContractPdf,
    deleteContractById,
    convertUrlToBase,
} = require("../../../controllers/admin/coaches/contractController");

// Route: 
router.post(
    "/create",
    authMiddleware,
    upload.single("pdfFile"),
    permissionMiddleware("contract", "create"),
    createContract
);

router.post(
    "/utils/url-to-base/",
    convertUrlToBase
)
router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("contract", "view-listing"),
    getAllContracts
);

router.get(
    "/listBy/:id",
    authMiddleware,
    permissionMiddleware("contract", "view-listing"),
    getContractById
);

router.put(
    "/update/:id",
    authMiddleware,
    upload.single("pdfFile"),
    permissionMiddleware("contract", "update"),
    updateContractById
);

router.delete(
    "/delete/:id",
    authMiddleware,
    upload.single("pdfFile"),
    permissionMiddleware("contract", "delete"),
    deleteContractById
);

router.get(
    "/:contractId/download",
    authMiddleware,
   permissionMiddleware("contract", "view-listing"),
   downloadContractPdf
);

module.exports = router;
