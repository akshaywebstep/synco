const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createBooking,
  getAllBookFreeTrials,
  getBookFreeTrialDetails,
  sendSelectedTrialistEmail,
  getAllAdmins,
  assignBookings,
} = require("../../controllers/admin/booking/bookFreeTrialController");

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

router.get(
  "/get-agents",
  authMiddleware,
  permissionMiddleware("book-free-trial", "view-listing"),
  getAllAdmins
);

router.put(
  "/assign-booking",
  authMiddleware,
  permissionMiddleware("book-free-trial", "view-listing"),
  assignBookings
);

// 📄 Get a specific free trial booking by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("book-free-trial", "view-listing"),
  getBookFreeTrialDetails
);

const {
  addCommentForFreeTrial,
  listCommentsForFreeTrial,
} = require("../../controllers/admin/booking/commentController");

router.post(
  "/comment/create",
  authMiddleware,
  permissionMiddleware("comment", "create"),
  addCommentForFreeTrial
);
router.get(
  "/comment/list",
  authMiddleware,
  permissionMiddleware("comment", "view-listing"),
  listCommentsForFreeTrial
);

module.exports = router;
