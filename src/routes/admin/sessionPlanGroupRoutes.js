const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");

const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

// ✅ Multer in-memory storage for banner & video uploads
const upload = multer();

const {
  createSessionPlanGroup,
  getAllSessionPlanGroups,
  getSessionPlanGroupDetails,
  updateSessionPlanGroup,
  deleteSessionPlanGroup,
  deleteSessionPlanGroupLevel,
  reorderSessionPlanGroups,
  downloadSessionPlanGroupVideo,
} = require("../../controllers/admin/sessionPlan/sessionPlanGroupController");

router.get(
  "/:id/download-video", // example route: /session-plan-group/:id/download-video
  authMiddleware,
  permissionMiddleware("session-plan-group", "view-listing"),
  downloadSessionPlanGroupVideo
);

// ✅ Create Session Plan Group
router.post(
  "/",
  authMiddleware,
  upload.any(), // ✅ accept banner, video, AND dynamic recording_* fields
  permissionMiddleware("session-plan-group", "create"),
  createSessionPlanGroup
);
// ✅ Get All Session Plan Groups

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("session-plan-group", "view-listing"),
  getAllSessionPlanGroups
);

// ✅ Get Session Plan Group by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("session-plan-group", "view-listing"),
  getSessionPlanGroupDetails
);

// ✅ Update Session Plan Group
router.put(
  "/:id",
  authMiddleware,
  upload.any(), // ✅ accept banner, video, AND dynamic recording_* fields
  permissionMiddleware("session-plan-group", "update"),
  updateSessionPlanGroup
);

// ✅ Delete Session Plan Group
permissionMiddleware("session-plan-group", "delete"),
  router.delete("/:id", authMiddleware, deleteSessionPlanGroup);

router.delete(
  "/:id/level/:levelKey",
  authMiddleware,
  permissionMiddleware("session-plan-group", "delete"),
  deleteSessionPlanGroupLevel
);
// ✅ Reorder Session Plan Groups
router.patch("/reorder", authMiddleware, reorderSessionPlanGroups);

module.exports = router;
