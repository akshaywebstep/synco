const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  findAHolidayClassListing,
  getHolidayClassScheduleById,
} = require("../../../controllers/admin/open/holidayFindACamp/findACampController");

router.get("/", findAHolidayClassListing);

router.get("/:id", getHolidayClassScheduleById);

module.exports = router;
