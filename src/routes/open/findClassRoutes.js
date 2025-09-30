const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  findAClassListing,
  getClassScheduleById
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

module.exports = router;
