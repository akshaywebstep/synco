const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  findAClassListing,
  getAllClassSchedules,
  getClassScheduleById,
} = require("../../controllers/admin/findClass/listingVenueAndClassController");

// ✅ Get ALL venues + classes
router.get(
  "/",
  findAClassListing
);
router.get(
  "/:id",
  getClassScheduleById
);
router.get(
  "/list",
  getAllClassSchedules
);

module.exports = router;
