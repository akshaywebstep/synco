const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const {
  getCombinedBookingsByParentAdminId,
  scheduleCancelMembership,
  getMyBookingsByParentAdminId,
} = require("../../controllers/admin/parentWebsite/accountProfileController");

// Bookings Get By ParentAdminId
router.get("/:parentAdminId", authMiddleware, getCombinedBookingsByParentAdminId); 
router.post("/cancel-booking", authMiddleware, scheduleCancelMembership); 
router.get("/my-bookings/:parentAdminId", authMiddleware, getMyBookingsByParentAdminId); 


const {
  createBooking
} = require("../../controllers/admin/booking/bookFreeTrialController");

// Create Free Trial Booking From Parent Portal
router.post("/:parentAdminId", authMiddleware, createBooking); 

module.exports = router;
