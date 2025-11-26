const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayVenue,
  getAllHolidayVenues,
  getHolidayVenueById,
  updateHolidayVenue,
  deleteHolidayVenue,
} = require("../../../controllers/admin/holidayCamps/venue/holidayVenueController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-venue", "create"),
  createHolidayVenue
);
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-venue", "view-listing"),
  getAllHolidayVenues
);
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-venue", "view-listing"),
  getHolidayVenueById
);
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-venue", "update"),
  updateHolidayVenue
);
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-venue", "delete"),
  deleteHolidayVenue
);

module.exports = router;
