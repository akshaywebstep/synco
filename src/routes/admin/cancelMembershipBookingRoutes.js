const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createCancelBooking,
  getCancelBookings,
  sendCancelBookingEmail,
  // createNoMembership,
} = require("../../controllers/admin/booking/cancelMembershipBookingController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("cancel-membership", "create"),
  createCancelBooking
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("cancel-membership", "view-listing"),
  sendCancelBookingEmail
);

module.exports = router;
