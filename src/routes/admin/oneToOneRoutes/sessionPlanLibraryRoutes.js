const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

// ✅ Multer in-memory storage for banner & video uploads
const upload = multer();

const {
  getAllSessionPlanGroupStructure,

} = require("../../../controllers/admin/oneToOne/sessionPlanLibrary/sessionPlanGroupController");

// ✅ Get All Session Plan Groups

router.get(
  "/session-plan-struture/listing",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "view-listing"),
  getAllSessionPlanGroupStructure
);

module.exports = router;
