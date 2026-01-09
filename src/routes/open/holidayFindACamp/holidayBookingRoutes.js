const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createHolidayBooking
} = require("../../../controllers/admin/holidayCamps/booking/holidayBookingController");

// ✅ Create a new free trial booking
router.post(
  "/create",
  openParam,
  createHolidayBooking
);

module.exports = router;
