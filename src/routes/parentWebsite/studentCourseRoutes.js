const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/admin/authenticate");

// Controllers
const {
    getAllStudentCoursesForParent,
    getStudentCourseByIdForParent,
   
} = require("../../controllers/admin/coaches/studentCourseController");
// -------------------- Routes --------------------

// Get bookings by Parent Admin ID
router.get(
  "/list",
//   authMiddleware,
  getAllStudentCoursesForParent
);

router.get(
  "/listBy/:id",
//   authMiddleware,
  getStudentCourseByIdForParent
);

module.exports = router;
