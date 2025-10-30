const express = require("express");
const router = express.Router();
const multer = require("multer");

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createOnetoOneLeads,
} = require("../../../controllers/admin/oneToOne/oneToOneLeadsController");

// ✅ Get All Session Plan Groups

router.post(
    "/leads/create",
    authMiddleware,
    permissionMiddleware("one-to-one-lead", "create"),
    createOnetoOneLeads
);

module.exports = router;
