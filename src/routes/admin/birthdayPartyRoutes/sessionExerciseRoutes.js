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
} = require("../../../controllers/admin/birthdayParty/sessionPlanLibrary/sessionExerciseController");

// ✅ Get All Session Plan Groups

router.post(
    "/session-exercise/create",
    authMiddleware,
    upload.array("images", 10),
    permissionMiddleware("session-exercise-birthdayParty", "create"),
    createSessionExercise
);

router.get(
    "/session-exercise/listing/:id",
    authMiddleware,
    permissionMiddleware("session-exercise-birthdayParty", "view-listing"),
    getSessionExerciseById
);

router.get(
    "/session-exercise/listing/",
    authMiddleware,
    permissionMiddleware("session-exercise-birthdayParty", "view-listing"),
    getAllSessionExercises
);

router.put(
    "/session-exercise/update/:id",
    authMiddleware,
    upload.array("images", 10),
    permissionMiddleware("session-exercise-birthdayParty", "update"),
    updateSessionExercise
);

router.delete(
    "/session-exercise/delete/:id",
    authMiddleware,
    permissionMiddleware("session-exercise-birthdayParty", "delete"),
    deleteSessionExercise
);

router.post(
  "/session-exercise/:id/duplicate",
  authMiddleware,
  upload.any(), // ✅ accept banner, video, AND dynamic recording_* fields
  permissionMiddleware("session-exercise-birthdayParty", "view-listing"),
  duplicateSessionExercise
);

module.exports = router;
