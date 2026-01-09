const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createHolidayBooking,
  waitingListCreate,
} = require("../../../controllers/admin/holidayCamps/booking/holidayBookingController");

// ✅ Create a new free trial booking
router.post(
  "/create",
  openParam,
  createHolidayBooking
);
router.post(
  "/waiting-list/create",
  openParam,
  waitingListCreate
);

module.exports = router;
