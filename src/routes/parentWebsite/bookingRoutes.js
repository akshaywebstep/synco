const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const {
  getCombinedBookingsByParentAdminId
} = require("../../controllers/admin/parentWebsite/accountProfileController");

// Bookings Get By ParentAdminId
router.get("/:paremtAdminId", authMiddleware, getCombinedBookingsByParentAdminId); 

const {
  createBooking
} = require("../../controllers/admin/booking/bookFreeTrialController");

// Create Free Trial Booking From Parent Portal
router.post("/create/:paremtAdminId", authMiddleware, createBooking); 

module.exports = router;
