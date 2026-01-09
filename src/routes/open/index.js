const express = require("express");
const router = express.Router();

// Find  Class Module Base Route
router.use("/find-class", require("./findAClass/findClassRoutes"));

// Book Free Trials Module Base Routes
router.use("/book-free-trial", require("./booking/bookFreeTrialsRoutes"));

// Waiting List Module Base Routes
router.use("/waiting-list", require("./booking/waitingListRoutes"));

// Book Membership Modle Base Routes
router.use("/book-membership", require("./booking/bookingMembershipRoutes"));

// Birthday Party Inqury Form
router.use("/birthday-party", require("./booking/birthdayPartyBookingRoutes"));

// One to One Inqury Form
router.use("/one-to-one", require("./booking/oneToOneBookingRoutes"));

// Find a Camp
router.use("/find-a-camp", require("./holidayFindACamp/findACampRoutes"));

// Holiday Booking
router.use("/book-holiday-camp", require("./holidayFindACamp/holidayBookingRoutes"));

module.exports = router;
