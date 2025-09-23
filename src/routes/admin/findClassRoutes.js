const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  findAClassListing,
} = require("../../controllers/admin/findClass/listingVenueAndClassController");

// ✅ Get ALL venues + classes
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("find-class", "view-listing"),
  findAClassListing
);

module.exports = router;
