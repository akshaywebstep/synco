const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

// ✅ Multer in-memory storage for banner & video uploads
const upload = multer();

const {
    createSessionExercise,
    getSessionExerciseById,
    getAllSessionExercises,
    updateSessionExercise,
    deleteSessionExercise,
    duplicateSessionExercise
} = require("../../../controllers/admin/oneToOne/sessionPlanLibrary/sessionExerciseController");

// ✅ Get All Session Plan Groups

router.post(
    "/session-exercise-struture/create",
    authMiddleware,
    upload.array("images", 10),
    permissionMiddleware("session-exercise-one-to-one", "create"),
    createSessionExercise
);

router.get(
    "/session-exercise-struture/listing/:id",
    authMiddleware,
    permissionMiddleware("session-exercise-one-to-one", "view-listing"),
    getSessionExerciseById
);

router.get(
    "/session-exercise-struture/listing/",
    authMiddleware,
    permissionMiddleware("session-exercise-one-to-one", "view-listing"),
    getAllSessionExercises
);

router.put(
    "/session-exercise-struture/update/:id",
    authMiddleware,
    upload.array("images", 10),
    permissionMiddleware("session-exercise-one-to-one", "update"),
    updateSessionExercise
);

router.delete(
    "/session-exercise-struture/delete/:id",
    authMiddleware,
    permissionMiddleware("session-exercise-one-to-one", "delete"),
    deleteSessionExercise
);

router.post(
  "/session-exercise-struture/:id/duplicate",
  authMiddleware,
  upload.any(), // ✅ accept banner, video, AND dynamic recording_* fields
  permissionMiddleware("session-exercise", "create"),
  duplicateSessionExercise
);

module.exports = router;
