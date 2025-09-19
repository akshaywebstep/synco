const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  cancelClassSession,
  // getAllCancelledSessions,
} = require("../../controllers/admin/classSchedule/cancelSessionController");

// ✅ Cancel a session for a specific class
router.post(
  "/:classScheduleId/cancel",
  authMiddleware,
  permissionMiddleware("cancel-session", "view-listing"),
  cancelClassSession
);

// ✅ Get all cancelled sessions for a specific class
// router.get("/", authMiddleware, getAllCancelledSessions);

module.exports = router;
