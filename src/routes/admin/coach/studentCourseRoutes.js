const express = require("express");
const router = express.Router();
const multer = require("multer");
// Multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
    createStudentCourse,
    getAllStudentCourses,
    getStudentCourseById,
    updateStudentCourse,
    // deleteCourse,
} = require("../../../controllers/admin/coaches/studentCourseController");

// Route: Upload music (unlimited files)
router.post(
    "/create",
    authMiddleware,
    upload.fields([
        { name: "coverImage", maxCount: 1 },
        { name: "videos", maxCount: 20 }, // multiple course videos
    ]),
    permissionMiddleware("student-course", "create"),
    createStudentCourse
);

router.get(
    "/list",
    authMiddleware,
    permissionMiddleware("student-course", "view-listing"),
    getAllStudentCourses
);

router.get(
    "/listBy/:id",
    authMiddleware,
    permissionMiddleware("student-course", "view-listing"),
    getStudentCourseById
);

router.put(
    "/update/:id",
    authMiddleware,
    upload.fields([
        { name: "coverImage", maxCount: 1 },
        { name: "videos", maxCount: 20 }, // multiple course videos
    ]),
    permissionMiddleware("student-course", "update"),
    updateStudentCourse
);

// router.delete(
//     "/delete/:id",
//     authMiddleware,
//     upload.any(),
//     permissionMiddleware("student-course", "delete"),
//     deleteCourse
// );
module.exports = router;
