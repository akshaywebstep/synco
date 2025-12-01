const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayBooking,
} = require("../../../controllers/admin/holidayCamps/booking/holidayBookingController");

// ➕ Create Camp

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-Booking", "create"),
  createHolidayBooking
);

module.exports = router;
