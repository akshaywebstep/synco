const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  getRequestToCancel,
  getBookingById,
  sendCancelBookingEmail,
} = require("../../controllers/admin/cancellation/requestToCancellationController");

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("cancellation", "view-listing"),
  getRequestToCancel
);

router.get(
  "/service-history/:id",
  authMiddleware,
  permissionMiddleware("cancellation", "view-listing"),
  getBookingById
);
router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("cancel-membership", "view-listing"),
  sendCancelBookingEmail
);

module.exports = router;
