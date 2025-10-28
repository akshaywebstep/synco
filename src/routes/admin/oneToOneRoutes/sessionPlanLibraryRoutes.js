const express = require("express");
const router = express.Router();
const multer = require("multer");

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

// ✅ Multer in-memory storage for banner & video uploads
const upload = multer();

// Controllers
const {
  getAllSessionPlanGroupStructure,
  repinSessionPlanGroup,
  getSessionPlanGroupStructureById,
  createSessionPlanGroupStructure,
  updateSessionPlanConfig,
  deleteSessionPlanConfig,
  deleteSessionPlanConfigLevel,

} = require("../../../controllers/admin/oneToOne/sessionPlanLibrary/sessionPlanGroupController");

// ✅ Create Session Plan Group with file uploads
router.post(
  "/session-plan-structure/create", // fixed typo
  authMiddleware,
  permissionMiddleware("session-plan-structure", "create"),
  upload.any(), // ✅ Parse any file uploads
  createSessionPlanGroupStructure
);

// ✅ Get All Session Plan Groups
router.get(
  "/session-plan-structure/listing",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "view-listing"),
  getAllSessionPlanGroupStructure
);

// ✅ Get Session Plan Group by ID
router.get(
  "/session-plan-structure/listing/:id",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "view-listing"),
  getSessionPlanGroupStructureById
);

router.put(
  "/session-plan-structure/:id/",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "update"),
  updateSessionPlanConfig
);

router.delete("/session-plan-structure/delete/:id", authMiddleware, permissionMiddleware("session-plan-structure", "delete"), deleteSessionPlanConfig);

router.delete(
  "/session-plan-structure/:id/level/:levelKey",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "delete"),
  deleteSessionPlanConfigLevel
);

// ✅ Repin Session Plan Group
router.put(
  "/session-plan-structure/:id/repin",
  authMiddleware,
  permissionMiddleware("session-plan-structure", "repin"),
  repinSessionPlanGroup
);

module.exports = router;
