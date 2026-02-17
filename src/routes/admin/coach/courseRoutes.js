const express = require("express");
const router = express.Router();
const multer = require("multer");
// Multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createCourse,
    getCourses,
    getCourseById,
    updateCourse,
    deleteCourse,
} = require("../../../controllers/admin/coaches/courseController");

// Route: Upload music (unlimited files)
router.post(
    "/create",
    authMiddleware,
    upload.any(),
    permissionMiddleware("course", "create"),
    createCourse
);

router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("course", "view-listing"),
    getCourses
);

router.get(
    "/listBy/:id",
    authMiddleware,
    permissionMiddleware("course", "view-listing"),
    getCourseById
);

router.put(
    "/update/:id",
    authMiddleware,
    upload.any(),
    permissionMiddleware("course", "update"),
    updateCourse
);

router.delete(
    "/delete/:id",
    authMiddleware,
    upload.any(),
    permissionMiddleware("course", "delete"),
    deleteCourse
);
module.exports = router;
