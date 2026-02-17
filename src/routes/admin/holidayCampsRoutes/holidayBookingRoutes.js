const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayBooking,
  getAllHolidayBooking,
  getHolidayCampsReports,
  sendEmail,
  getHolidayBookingById,
  updateHolidayBooking,
  waitingListCreate,
  cancelHolidayBookingById,
  getAllDiscounts,
  assignBookings,
  sendBookingSMSToParents,
} = require("../../../controllers/admin/holidayCamps/booking/holidayBookingController");

// ➕ Create Camp

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-booking", "create"),
  createHolidayBooking
);

router.post(
  "/send-text",
  authMiddleware,
  sendBookingSMSToParents
)

router.put(
  "/assign-booking",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  assignBookings
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getAllHolidayBooking
);

router.get(
  "/discount/holiday-camp",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getAllDiscounts
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  sendEmail
);

router.put(
  "/update/:bookingId",
  authMiddleware,
  permissionMiddleware("holiday-booking", "update"),
  updateHolidayBooking
);

router.get(
  "/listBy/:bookingId",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getHolidayBookingById
);

router.post(
  "/waiting-list/create",
  authMiddleware,
  permissionMiddleware("holiday-booking-waiting", "create"),
  waitingListCreate
);
router.get(
  "/reports",
  authMiddleware,
  permissionMiddleware("holiday-booking", "view-listing"),
  getHolidayCampsReports
);

router.put(
  "/cancel/:id",
  authMiddleware,
  permissionMiddleware("holiday-booking", "update"),
  cancelHolidayBookingById
);

module.exports = router;
