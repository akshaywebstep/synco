const express = require("express");
const router = express.Router();
const multer = require("multer");

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

// ✅ Multer in-memory storage for banner & video uploads
const upload = multer();
const fs = require("fs");

// Controllers
const {
  getAllSessionPlanGroupStructure,
  getSessionPlanGroupStructureById,
  createSessionPlanGroupStructure,
  updateSessionPlanConfig,
  deleteSessionPlanConfig,
  deleteSessionPlanConfigLevel,
  downloadSessionPlanConfigVideo,
  reorderSessionPlanGroups,

} = require("../../../controllers/admin/birthdayParty/sessionPlanLibrary/sessionPlanGroupController");

router.get(
  "/session-plan-birthdayParty/:id/download-video", // example route: /session-plan-group/:id/download-video
  authMiddleware,
  permissionMiddleware("session-plan-birthdayParty", "view-listing"),
  downloadSessionPlanConfigVideo
);

// ✅ Create Session Plan Group with file uploads
router.post(
  "/session-plan-birthdayParty/create", 
  authMiddleware,
  permissionMiddleware("session-plan-birthdayParty", "create"),
  upload.any(), // ✅ Parse any file uploads
  createSessionPlanGroupStructure
);

// ✅ Get All Session Plan Groups
router.get(
  "/session-plan-birthdayParty/listing",
  authMiddleware,
  permissionMiddleware("session-plan-birthdayParty", "view-listing"),
  getAllSessionPlanGroupStructure
);

// ✅ Get Session Plan Group by ID
router.get(
  "/session-plan-birthdayParty/listing/:id",
  authMiddleware,
  permissionMiddleware("session-plan-birthdayParty", "view-listing"),
  getSessionPlanGroupStructureById
);

router.put(
  "/session-plan-birthdayParty/update/:id/",
  authMiddleware,
  upload.any(),
  permissionMiddleware("session-plan-birthdayParty", "update"),
  updateSessionPlanConfig
);

router.delete("/session-plan-birthdayParty/delete/:id", authMiddleware, permissionMiddleware("session-plan-birthdayParty", "delete"), deleteSessionPlanConfig);

router.delete(
  "/session-plan-birthdayParty/:id/level/:levelKey",
  authMiddleware,
  permissionMiddleware("session-plan-birthdayParty", "view-listing"),
  deleteSessionPlanConfigLevel
);

// ✅ Reorder Session Plan Groups
router.patch("/session-plan-birthdayParty/reorder", authMiddleware, reorderSessionPlanGroups);

module.exports = router;
