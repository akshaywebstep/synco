const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const {
  // createNotification,
  getAllNotifications,
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
  getAllNotifications
);

module.exports = router;
