const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/admin/authenticate");

// Controllers
const {
  getCombinedBookingsByParentAdminId,
} = require("../../controllers/admin/parentWebsite/accountProfileController");

const {
  createBooking: createFreeTrialBooking,
} = require("../../controllers/admin/booking/bookFreeTrialController");

const {
  createBooking: createMembershipBooking,
} = require("../../controllers/admin/booking/bookingMembershipController");

const {
  createBooking: createWaitingListBooking,
} = require("../../controllers/admin/booking/waitingListController");

// -------------------- Routes --------------------

// Get bookings by Parent Admin ID
router.get(
  "/:parentAdminId",
  authMiddleware,
  getCombinedBookingsByParentAdminId
);

// Create Free Trial booking
router.post(
  "/free-trial/create/:parentAdminId",
  authMiddleware,
  createFreeTrialBooking
);

// Create Membership booking
router.post(
  "/membership/create/:parentAdminId",
  authMiddleware,
  createMembershipBooking
);

// Create Waiting List booking
router.post(
  "/waiting-list/create/:parentAdminId",
  authMiddleware,
  createWaitingListBooking
);

module.exports = router;
