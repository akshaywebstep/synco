const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createBooking
} = require("../../../controllers/admin/booking/bookingMembershipController");

// ✅ Create a new free trial booking
router.post(
  "/",
  openParam,
  createBooking
);

module.exports = router;
