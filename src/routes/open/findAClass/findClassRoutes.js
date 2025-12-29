const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  findAClassListing,
  getClassScheduleById,
} = require("../../../controllers/admin/open/findClass/listingVenueAndClassController");

router.get("/", findAClassListing);

router.get("/:id", getClassScheduleById);

module.exports = router;
