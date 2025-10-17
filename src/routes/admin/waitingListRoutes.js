const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createBooking,
  getAllWaitingListBookings,
  getAccountProfile,
  sendEmail,
  removeWaitingList,
  convertToMembership,
  updateWaitinglistBooking,
} = require("../../controllers/admin/booking/waitingListController");

const {
  addCommentForWaitingList,
  listCommentsForWaitingList,
} = require("../../controllers/admin/booking/commentController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("waiting-list", "create"),
  createBooking
);

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("waiting-list", "view-listing"),
  getAllWaitingListBookings
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("waiting-list", "view-listing"),
  sendEmail
);

// ✅ Remove from waiting list route
router.post(
  "/from/remove",
  authMiddleware,
  permissionMiddleware("waiting-list", "remove"), // new permission key
  removeWaitingList
);

router.post(
  "/comment/create",
  authMiddleware,
  permissionMiddleware("comment", "create"),
  addCommentForWaitingList
);
router.get(
  "/comment/list",
  authMiddleware,
  permissionMiddleware("comment", "view-listing"),
  listCommentsForWaitingList
);

router.put(
  "/service-history/update/:bookingId",
  authMiddleware,
  permissionMiddleware("waiting-list", "update"),
  updateWaitinglistBooking
);

router.get(
  "/service-history/:id",
  authMiddleware,
  permissionMiddleware("waiting-list", "view-listing"),
  getAccountProfile
);

router.put(
  "/convert-membership/:id", // ✅ add :id here
  authMiddleware,
  permissionMiddleware("waiting-list", "remove"),
  convertToMembership
);
router.post(
  "/:leadId",
  authMiddleware,
  permissionMiddleware("waiting-list", "create"),
  createBooking
);

module.exports = router;
