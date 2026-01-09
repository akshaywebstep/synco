const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createHolidayBooking,
  waitingListCreate,
  getBookingByIdForWebsitePreview,
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
router.get(
  "/preview/:bookingId",
  openParam,
  getBookingByIdForWebsitePreview
);

module.exports = router;
