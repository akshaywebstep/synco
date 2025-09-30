const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createCustomNotification,
  getAllCustomNotifications,
  getAllAdmins,
} = require("../../controllers/admin/notification/customNotificationController");

// Create a new notification
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("custom-notification", "create"),
  createCustomNotification
);
router.get(
  "/all",
  authMiddleware,
  permissionMiddleware("custom-notification", "view-listing"),
  getAllAdmins
);

// Get all notifications
router.get("/", authMiddleware, getAllCustomNotifications);

module.exports = router;
