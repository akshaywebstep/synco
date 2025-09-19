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
} = require("../../controllers/admin/sessionPlan/sessionPlanGroupController");

// ✅ Create Session Plan Group
// router.post(
//   "/",
//   authMiddleware,
//   upload.fields([
//     { name: "video", maxCount: 1 },
//     { name: "banner", maxCount: 1 },
//     { name: "video_file", maxCount: 1 }, // ✅ add
//     { name: "banner_file", maxCount: 1 }, // ✅ add
//   ]),
//   permissionMiddleware("session-plan-group", "create"),
//   createSessionPlanGroup
// );

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
  // upload.fields([
  //   { name: "video", maxCount: 1 },
  //   { name: "banner", maxCount: 1 },
  //   { name: "video_file", maxCount: 1 }, // ✅ add
  //   { name: "banner_file", maxCount: 1 }, // ✅ add
  // ]),
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
