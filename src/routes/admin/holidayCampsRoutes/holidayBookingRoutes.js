const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayBooking,
  getAllHolidayBooking,
  sendEmail,
  getHolidayBookingById,
  updateHolidayBooking,
  // addCommentForHolidayCamp,
  // listCommentsForHolidayCamp,
  waitingListCreate,
  getHolidayCampsReports,
  cancelHolidayBookingById,
  getAllDiscounts,
} = require("../../../controllers/admin/holidayCamps/booking/holidayBookingController");

// ================= COMMENTS =================
// router.post(
//   "/comment/create",
//   authMiddleware,
//   permissionMiddleware("holiday-comment", "create"),
//   addCommentForHolidayCamp
// );

// router.get(
//   "/comment/list",
//   authMiddleware,
//   permissionMiddleware("holiday-comment", "view-listing"),
//   listCommentsForHolidayCamp
// );

// ================= DISCOUNTS =================
router.get(
  "/discount/holiday-camp",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getAllDiscounts
);

// ================= REPORTS =================
router.get(
  "/reports",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getHolidayCampsReports
);

// ================= WAITING LIST =================
router.post(
  "/waiting-list/create",
  authMiddleware,
  permissionMiddleware("holiday-booking-waiting", "create"),
  waitingListCreate
);

// ================= BOOKINGS =================
router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-booking", "create"),
  createHolidayBooking
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getAllHolidayBooking
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  sendEmail
);

// ================= DYNAMIC ROUTES (LAST) =================
router.get(
  "/listBy/:bookingId",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getHolidayBookingById
);

router.put(
  "/update/:bookingId",
  authMiddleware,
  permissionMiddleware("holiday-booking", "update"),
  updateHolidayBooking
);

router.put(
  "/cancel/:id",
  authMiddleware,
  permissionMiddleware("holiday-booking", "update"),
  cancelHolidayBookingById
);

module.exports = router;
