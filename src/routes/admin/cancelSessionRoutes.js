const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  cancelClassSession,
  getCancelledSessionById,
} = require("../../controllers/admin/classSchedule/cancelSessionController");

// ✅ Cancel a session for a specific class
router.post(
  "/:classScheduleId/cancel",
  authMiddleware,
  permissionMiddleware("cancel-session", "view-listing"),
  cancelClassSession
);

// Get a cancelled session by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("cancel-session", "view-listing"),
  getCancelledSessionById
);

module.exports = router;
