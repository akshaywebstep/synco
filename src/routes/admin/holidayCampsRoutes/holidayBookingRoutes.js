const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayBooking,
  getAllHolidayBooking,
} = require("../../../controllers/admin/holidayCamps/booking/holidayBookingController");

// ➕ Create Camp

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-booking", "create"),
  createHolidayBooking
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getAllHolidayBooking
);

module.exports = router;
