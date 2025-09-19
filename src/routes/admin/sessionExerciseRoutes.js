const express = require("express");
const router = express.Router();
const multer = require("multer");

const authMiddleware = require("../../middleware/admin/authenticate");
const upload = multer(); // ✅ Handles multipart/form-data
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createSessionExercise,
  getAllSessionExercises,
  getSessionExerciseById,
  updateSessionExercise,
  deleteSessionExercise,
} = require("../../controllers/admin/sessionPlan/sessionExerciseController");

// 🌐 Base Path: /api/admin/session-plan-exercise

router.post(
  "/",
  authMiddleware,
  upload.array("images", 10),
  permissionMiddleware("session-exercise", "create"),
  createSessionExercise
);

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("session-exercise", "view-listing"),
  getAllSessionExercises
);

router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("session-exercise", "view-listing"),
  getSessionExerciseById
);

router.put(
  "/:id",
  authMiddleware,
  upload.array("images", 10),
  authMiddleware,
  permissionMiddleware("session-exercise", "update"),
  updateSessionExercise
);
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("session-exercise", "delete"),
  deleteSessionExercise
);

module.exports = router;
