const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  getFullCancelBookings,
  getFullCancelBookingById,
  sendCancelBookingEmail,
} = require("../../controllers/admin/cancellation/allListController");

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("cancellation", "view-listing"),
  getFullCancelBookings
);

router.get(
  "/service-history/:id",
  authMiddleware,
  permissionMiddleware("cancellation", "view-listing"),
  getFullCancelBookingById
);
router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("cancel-membership", "view-listing"),
  sendCancelBookingEmail
);

module.exports = router;
