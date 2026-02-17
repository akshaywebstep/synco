const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
    createFeedback,
    getAllFeedbacks,
    getFeedbackById,
    resolveFeedback,
    getAgentsAndClasses,
    getAgentsAndHolidayClasses,
    // getEventsByBookingId,
} = require("../../controllers/admin/feedbackController");

router.post(
    "/create",
    authMiddleware,
    permissionMiddleware("feedback", "create"),
    createFeedback
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("feedback", "view-listing"),
  getAllFeedbacks
);

router.get(
  "/agent-classes/list",
  authMiddleware,
  permissionMiddleware("feedback", "view-listing"),
  getAgentsAndClasses
);
router.get(
  "/agent-holiday-classes/list",
  authMiddleware,
  permissionMiddleware("feedback", "view-listing"),
  getAgentsAndHolidayClasses
);

router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("feedback", "view-listing"),
  getFeedbackById
);
router.put(
  "/resolve/:feedbackId/",
  authMiddleware,
  permissionMiddleware("feedback", "update"),
  resolveFeedback
);

// router.get(
//   "/events/:bookingId",
//   authMiddleware,
//   permissionMiddleware("event", "view-listing"),
//   getEventsByBookingId
// );

module.exports = router;
