const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
    // getSelectedBookFreeTrials,
    getAccountProfile,
    updateBooking,
    updateBookingStudents,
} = require("../../controllers/admin/booking/serviceHistoryController");

// router.get("/selected/:id", authMiddleware, getSelectedBookFreeTrials);
router.get(
    "/account-profile/:id",
    authMiddleware,
    permissionMiddleware("service-history", "view-listing"),
    getAccountProfile
);
router.put(
    "/trial-to-membership/:id",
    authMiddleware,
    permissionMiddleware("book-membership", "update"),
    updateBooking
);
router.put(
    "/update-booking/information/:bookingId",
    authMiddleware,
    permissionMiddleware("book-free-trial", "update"),
    updateBookingStudents
);
module.exports = router;
