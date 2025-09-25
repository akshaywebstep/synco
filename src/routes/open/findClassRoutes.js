const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  findAClassListing,
} = require("../../controllers/admin/findClass/listingVenueAndClassController");

// ✅ Get ALL venues + classes
router.get(
  "/",
  findAClassListing
);

module.exports = router;
