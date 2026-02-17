const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

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
