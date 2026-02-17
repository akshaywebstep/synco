const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createBooking,
  getAllPaidBookings,
  sendSelectedMemberEmail,
  getAllPaidActiveBookings,
  sendActiveSelectedMemberEmail,
  transferClass,
  addToWaitingList,
  getWaitingList,
  getBookingsById,
  retryBookingPayment,
  listFailedPayments,
  updateBooking,
} = require("../../controllers/admin/booking/bookingMembershipController");

// ✅ Create 
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("book-membership", "create"),
  createBooking
);

router.post(
  "/:leadId",
  authMiddleware,
  permissionMiddleware("book-membership", "create"),
  createBooking
);

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  getAllPaidBookings
);
router.post(
  "/send/email",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  sendSelectedMemberEmail
);
router.get(
  "/active",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  getAllPaidActiveBookings
);
router.post(
  "/send-email/active-selected",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  sendActiveSelectedMemberEmail
);

router.get(
  "/account-information/:bookingId",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  getBookingsById
);

router.post(
  "/transfer/class/",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  transferClass
);

router.post(
  "/add-to/waiting-list",
  authMiddleware,
  permissionMiddleware("add-waiting-list", "create"),
  addToWaitingList
);

router.get(
  "/waiting-list/listing",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  getWaitingList
);

router.put(
  "/retry/payment/:bookingId",
  authMiddleware,
  permissionMiddleware("retry-payment", "update"),
  retryBookingPayment
);

router.put(
  "/:bookingId",
  authMiddleware,
  permissionMiddleware("book-membership", "update"),
  updateBooking
);

router.get(
  "/failed/:bookingId",
  authMiddleware,
  permissionMiddleware("failed-payment", "view-listing"),
  listFailedPayments
);

const {
  addCommentForMembership,
  listCommentsForMembership,
} = require("../../controllers/admin/booking/commentController");

router.post(
  "/comment/create",
  authMiddleware,
  permissionMiddleware("comment", "create"),
  addCommentForMembership
);
router.get(
  "/comment/list",
  authMiddleware,
  permissionMiddleware("comment", "view-listing"),
  listCommentsForMembership
);

module.exports = router;
