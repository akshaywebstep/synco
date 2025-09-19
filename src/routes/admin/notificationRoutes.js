const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  // createNotification,
  getAllNotifications,
  markNotificationAsRead,
} = require("../../controllers/admin/notification/notificationController");

/*
  // Create a new notification
  router.post("/", authMiddleware, createNotification);
*/

// Mark a notification as read (expects notificationId in body or query)
router.patch(
  "/read",
  authMiddleware,
  permissionMiddleware("notification", "read"),
  markNotificationAsRead
);

// Get all notifications

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("notification", "view-listing"),
  getAllNotifications
);

module.exports = router;
