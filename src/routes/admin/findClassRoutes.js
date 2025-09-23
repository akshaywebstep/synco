const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  findAClassListing,
  getAllClassSchedules,
  getClassScheduleById,
  // findAClassByVenue,
  // listTerms,
} = require("../../controllers/admin/findClass/listingVenueAndClassController");

// ✅ Get ALL venues + classes
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("find-class", "view-listing"),
  findAClassListing
);
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("find-class", "view-listing"),
  getClassScheduleById
);
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("find-class", "view-listing"),
  getAllClassSchedules
);

// ✅ Get ONLY specific venue & its classes
// router.get("/venue/:venueId", authMiddleware, findAClassByVenue);
// router.get("/term-groups-with-terms", authMiddleware, listTerms);
module.exports = router;
