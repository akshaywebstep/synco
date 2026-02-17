const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  getAllStudentsListing,
  updateBooking,
  getBookingById,
  getVenuesWithClassesFromBookings,
} = require("../../controllers/admin/accountInformations/accountInformationController");

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getAllStudentsListing
);

router.put(
  "/:bookingId",
  authMiddleware,
  permissionMiddleware("account-information", "update"),
  updateBooking
);

router.post(
  "/:id",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getBookingById
);

router.get(
  "/venues/classes/:bookingId",
  authMiddleware,
  permissionMiddleware("account-information", "view-listing"),
  getVenuesWithClassesFromBookings
);

module.exports = router;
