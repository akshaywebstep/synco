const express = require("express");
const router = express.Router();

// Find  Class Module Base Route
router.use("/find-class", require("./findAClass/findClassRoutes"));

// Book Free Trials Module Base Routes
router.use("/book/free-trials", require("./bookFreeTrialsRoutes"));

// Waiting List Module Base Routes
router.use("/waiting-list", require("./waitingListRoutes"));

// Book Membership Modle Base Routes
router.use("/book-membership", require("./bookingMembershipRoutes"));

module.exports = router;
