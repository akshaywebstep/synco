const express = require("express");
const router = express.Router();
const multer = require("multer");

const authMiddleware = require("../../../middleware/admin/authenticate");
const upload = multer(); // ✅ Handles multipart/form-data
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidaySessionExercise,
  getAllHolidaySessionExercises,
  getHolidaySessionExerciseById,
  updateHolidaySessionExercise,
  deleteHolidaySessionExercise,
  duplicateHolidaySessionExercise,
} = require("../../../controllers/admin/holidayCamps/sessionPlan/holidaySessionExerciseController");

// 🌐 Base Path: /api/admin/session-plan-exercise

router.post(
  "/create",
  authMiddleware,
  upload.array("images", 10),
  permissionMiddleware("holiday-session-exercise", "create"),
  createHolidaySessionExercise
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-session-exercise", "view-listing"),
  getAllHolidaySessionExercises
);

router.get(
  "/listById/:id",
  authMiddleware,
  permissionMiddleware("holiday-session-exercise", "view-listing"),
  getHolidaySessionExerciseById
);

router.put(
  "/:id",
  authMiddleware,
  upload.array("images", 10),
  permissionMiddleware("holiday-session-exercise", "update"),
  updateHolidaySessionExercise
);
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-session-exercise", "delete"),
  deleteHolidaySessionExercise
);

router.post(
  "/:id/duplicate",
  authMiddleware,
  upload.any(), // ✅ accept banner, video, AND dynamic recording_* fields
  permissionMiddleware("holiday-session-exercise", "view-listing"),
  duplicateHolidaySessionExercise
);

module.exports = router;
