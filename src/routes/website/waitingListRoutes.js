const express = require("express");
const router = express.Router();
const openParam = require("../../middleware/open");

const {
  createBooking
} = require("../../controllers/admin/booking/waitingListController");

router.post(
  "/",
  openParam,
  createBooking
);

module.exports = router;
