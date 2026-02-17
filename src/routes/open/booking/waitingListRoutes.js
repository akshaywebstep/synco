const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

// const {
//   createBooking
// } = require("../../../controllers/admin/website/booking/waitingListController");
const {
  createBooking,
} = require("../../../controllers/admin/booking/waitingListController");
// create waiting list
router.post("/create", openParam, createBooking);

module.exports = router;
