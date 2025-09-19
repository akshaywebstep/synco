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
} = require("../../controllers/admin/booking/bookingMembershipController");

// ✅ Create a new free trial booking
router.post(
  "/",
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
  "/send-email",
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
  "/transfer-class",
  authMiddleware,
  permissionMiddleware("book-membership", "view-listing"),
  transferClass
);
router.post(
  "/waiting-list",
  authMiddleware,
  permissionMiddleware("waiting-list", "create"),
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

router.get(
  "/failed/:bookingId",
  authMiddleware,
  permissionMiddleware("failed-payment", "view-listing"),
  listFailedPayments
);

const {
  createFreezeBooking,
  listFreezeBookings,
  reactivateBooking,
  cancelWaitingListSpot,
} = require("../../controllers/admin/booking/freezeBookingController");

// ✅ Cancel a session for a specific class
router.post(
  "/freeze",
  authMiddleware,
  permissionMiddleware("freeze", "create"),
  createFreezeBooking
);
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("freeze", "view-listing"),
  listFreezeBookings
);

router.post(
  "/reactivate",
  authMiddleware,
  permissionMiddleware("freeze", "view-listing"),
  reactivateBooking
);

router.put(
  "/cancel/waiting-list-spot",
  authMiddleware,
  permissionMiddleware("freeze", "view-listing"),
  cancelWaitingListSpot
);

module.exports = router;
