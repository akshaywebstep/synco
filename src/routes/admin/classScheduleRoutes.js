const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createClassSchedule,
  updateClassSchedule,
  getAllClassSchedules,
  getClassScheduleDetails,
  deleteClassSchedule,
} = require("../../controllers/admin/classSchedule/classScheduleController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("class-schedule", "create"),
  createClassSchedule
);
router.put(
  "/:id",
  authMiddleware,
  permissionMiddleware("class-schedule", "update"),
  updateClassSchedule
);
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("class-schedule", "view-listing"),
  getAllClassSchedules
);
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("class-schedule", "view-listing"),
  getClassScheduleDetails
);
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("class-schedule", "delete"),
  deleteClassSchedule
);

const {
  getAttendanceRegister,
  updateAttendanceStatus,
} = require("../../controllers/admin/classSchedule/viewClassRegisterController");

router.get(
  "/view-class-register/:classScheduleId",
  authMiddleware,
  permissionMiddleware("class-schedule", "view-listing"),
  getAttendanceRegister
)

router.patch(
  "/attendance/:studentId",
  authMiddleware,
  permissionMiddleware("class-schedule", "update"),
  updateAttendanceStatus);

module.exports = router;
