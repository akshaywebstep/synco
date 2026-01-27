const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/admin/authenticate");

// Controllers
const {
  findAHolidayClassListing,
  getHolidayClassScheduleById,
  updateHolidayBooking,
} = require("../../controllers/admin/parentWebsite/holidayController");
const {
  createHolidayBooking
} = require("../../controllers/admin/holidayCamps/booking/holidayBookingController");

const {
  createFeedback
} = require("../../controllers/admin/feedbackController");

// -------------------- Routes --------------------

// Get bookings by Parent Admin ID
router.get(
  "/find-a-camp",
  authMiddleware,
  findAHolidayClassListing
);

// Create Free Trial booking
router.get(
  "/find-a-camp/:id",
  authMiddleware,
  getHolidayClassScheduleById
);

router.post(
  "/book-a-camp",
  authMiddleware,
  createHolidayBooking
);

router.put(
  "/booking/update/:bookingId",
  authMiddleware,
  updateHolidayBooking
);
router.post(
  "/feedback/create",
  authMiddleware,
  createFeedback
);

module.exports = router;
