const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  findAHolidayClassListing,
//   getClassScheduleById,
} = require("../../../controllers/admin/open/holidayFindACamp/findACampController");

router.get("/", findAHolidayClassListing);

// router.get("/:id", getClassScheduleById);

module.exports = router;
