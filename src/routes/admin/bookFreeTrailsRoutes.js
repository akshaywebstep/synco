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

// service histrory-------------------------------------------------------------------------------------
const {
  // getSelectedBookFreeTrials,
  getAccountProfile,
  updateBooking,
  updateBookingStudents,
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
router.put(
  "/service-history/update-booking/information/:bookingId",
  authMiddleware,
  permissionMiddleware("book-free-trial", "update"),
  updateBookingStudents
);

// rebooking routes--------------------------------------------------------------------------------------
const {
  createRebookingTrial,
  getAllRebookingTrials,
  sendRebookingEmail,
} = require("../../controllers/admin/booking/reebookFreeTrialController");

// POST → create a rebooking
router.post(
  "/reebooking",
  authMiddleware,
  permissionMiddleware("rebooking", "create"),
  createRebookingTrial
);

// GET → get all rebookings for a booking
router.get(
  "/reebooking",
  authMiddleware,
  permissionMiddleware("rebooking", "view-listing"),
  getAllRebookingTrials
);
router.post(
  "/reebooking/trial/send-email",
  authMiddleware,
  permissionMiddleware("rebooking", "view-listing"),
  sendRebookingEmail
);

// cancel free trials ------------------------------------------------------------------------------------
// const {
//   createCancelBooking,
//   getCancelBookings,
//   sendCancelBookingEmail,
//   // createNoMembership,
// } = require("../../controllers/admin/booking/cancelBookingController");

// router.post(
//   "/cancel-freeTrial",
//   authMiddleware,
//   permissionMiddleware("cancel-free-trial", "create"),
//   createCancelBooking
// );

// router.get(
//   "/cancel-freeTrial",
//   authMiddleware,
//   permissionMiddleware("cancel-free-trial", "view-listing"),
//   getCancelBookings
// );

// router.post(
//   "/cancel-freeTrial/send-email",
//   authMiddleware,
//   permissionMiddleware("cancel-free-trial", "view-listing"),
//   sendCancelBookingEmail
// );

// no membership selected --------------------------------------------------------------------------------
const {
  createNoMembershipTrial,
  getNoMembershipTrials,
  sendNoMembershipTrialEmail,
} = require("../../controllers/admin/booking/noMembershipTrialController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("no-membership-trial", "create"),
  createNoMembershipTrial
);
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("no-membership-trial", "view-listing"),
  getNoMembershipTrials
);
router.post(
  "/send-email/",
  authMiddleware,
  permissionMiddleware("no-membership-trial", "view-listing"),
  sendNoMembershipTrialEmail
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
