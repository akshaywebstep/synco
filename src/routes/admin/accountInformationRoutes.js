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

// router.get(
//   "/service-history/:bookingId",
//   authMiddleware,
//   permissionMiddleware("account-information", "view-listing"),
//   getBookingsById
// );

router.get(
  "/venues/classes/:bookingId",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getVenuesWithClassesFromBookings
);

module.exports = router;
