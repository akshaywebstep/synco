const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const {
  getAllNotificationsForParent,
  markNotificationAsRead,
} = require("../../controllers/admin/notification/notificationController");

// Mark a notification as read (expects notificationId in body or query)
router.patch(
  "/read",
  authMiddleware,
  markNotificationAsRead
);

// Get all notifications

router.get(
  "/",
  authMiddleware,
  getAllNotificationsForParent
);

module.exports = router;
