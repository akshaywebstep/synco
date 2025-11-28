const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayClassSchedule,
  updateHolidayClassSchedule,
  getAllHolidayClassSchedules,
  getHolidayClassScheduleDetails,
  deleteHolidayClassSchedule,
} = require("../../../controllers/admin/holidayCamps/classSchedule/holidayClassSchdeduleController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-class-schedule", "create"),
  createHolidayClassSchedule
);
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-class-schedule", "update"),
  updateHolidayClassSchedule
);
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-class-schedule", "view-listing"),
  getAllHolidayClassSchedules
);
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-class-schedule", "view-listing"),
  getHolidayClassScheduleDetails
);
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-class-schedule", "delete"),
  deleteHolidayClassSchedule
);

// const {
//   getAttendanceRegister,
//   updateAttendanceStatus,
// } = require("../../controllers/admin/classSchedule/viewClassRegisterController");

// router.get(
//   "/view-class-register/:classScheduleId",
//   authMiddleware,
//   permissionMiddleware("class-schedule", "view-listing"),
//   getAttendanceRegister
// )

// router.patch(
//   "/attendance/:studentId",
//   authMiddleware,
//   permissionMiddleware("class-schedule", "update"),
//   updateAttendanceStatus);

module.exports = router;
