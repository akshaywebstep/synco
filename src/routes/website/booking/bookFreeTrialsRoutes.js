const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createBooking
} = require("../../../controllers/admin/website/booking/bookFreeTrialsController");

// ✅ Create a new free trial booking
router.post(
  "/create",
  openParam,
  createBooking
);

module.exports = router;
