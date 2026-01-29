const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const {
  getCombinedBookingsByParentAdminId,
  scheduleCancelMembership
} = require("../../controllers/admin/parentWebsite/accountProfileController");

// Bookings Get By ParentAdminId
router.get("/:paremtAdminId", authMiddleware, getCombinedBookingsByParentAdminId); 
router.post("/cancel-booking", authMiddleware, scheduleCancelMembership); 

const {
  createBooking
} = require("../../controllers/admin/booking/bookFreeTrialController");

// Create Free Trial Booking From Parent Portal
router.post("/:paremtAdminId", authMiddleware, createBooking); 

module.exports = router;
