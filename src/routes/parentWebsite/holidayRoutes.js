const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/admin/authenticate");

// Controllers
const {
  findAHolidayClassListing,
  getHolidayClassScheduleById,
} = require("../../controllers/admin/parentWebsite/holidayController");

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

module.exports = router;
