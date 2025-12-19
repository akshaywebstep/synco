const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  getAllStudentsListing,
  getStudentById,
  updateBooking,
  getBookingsById,
  getVenuesWithClassesFromBookings,
  // createFeedback,
  // listAllFeedbacks,
  // getFeedbackById,
  // resolveFeedback,
  // getEventsByBookingId,
} = require("../../controllers/admin/accountInformations/accountInformationController");

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getAllStudentsListing
);

router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getStudentById
);

router.put(
  "/:bookingId",
  authMiddleware,
  permissionMiddleware("account-information", "update"),
  updateBooking
);

router.get(
  "/service-history/:bookingId",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getBookingsById
);

router.get(
  "/venues/classes/:bookingId",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getVenuesWithClassesFromBookings
);
// router.post(
//   "/feedback",
//   authMiddleware,
//   permissionMiddleware("feedback", "create"),
//   createFeedback
// );

// router.get(
//   "/feedback/booking/:bookingId",
//   authMiddleware,
//   permissionMiddleware("feedback", "view-listing"),
//   listAllFeedbacks
// );

// router.get(
//   "/feedback/:id",
//   authMiddleware,
//   permissionMiddleware("feedback", "view-listing"),
//   getFeedbackById
// );
// router.put(
//   "/feedback/:feedbackId/resolve",
//   authMiddleware,
//   permissionMiddleware("feedback", "update"),
//   resolveFeedback
// );

// router.get(
//   "/events/:bookingId",
//   authMiddleware,
//   permissionMiddleware("event", "view-listing"),
//   getEventsByBookingId
// );

module.exports = router;
