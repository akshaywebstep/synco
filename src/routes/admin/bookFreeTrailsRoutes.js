const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createBooking,
  getAllBookFreeTrials,
  getBookFreeTrialDetails,
  sendSelectedTrialistEmail,
} = require("../../controllers/admin/booking/bookFreeTrailController");

// 📧 Send trial confirmation emails
router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("book-free-trial", "view-listing"),
  sendSelectedTrialistEmail
);

// ✅ Create a new free trial booking
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("book-free-trial", "create"),
  createBooking
);

// Booking for a specific lead
router.post(
  "/:leadId",
  authMiddleware,
  permissionMiddleware("book-free-trial", "create"),
  createBooking
);

// 📦 Get all free trial bookings
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("book-free-trial", "view-listing"),
  getAllBookFreeTrials
);

// 📄 Get a specific free trial booking by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("book-free-trial", "view-listing"),
  getBookFreeTrialDetails
);

const {
  // getSelectedBookFreeTrials,
  getAccountProfile,
  updateBooking,
} = require("../../controllers/admin/booking/serviceHistoryController");

// router.get("/selected/:id", authMiddleware, getSelectedBookFreeTrials);
router.get(
  "/service-history/account-profile/:id",
  authMiddleware,
  permissionMiddleware("service-history", "view-listing"),
  getAccountProfile
);
router.put(
  "/service-history/trial-to-membership/:id",
  authMiddleware,
  permissionMiddleware("book-membership", "update"),
  updateBooking
);

module.exports = router;
