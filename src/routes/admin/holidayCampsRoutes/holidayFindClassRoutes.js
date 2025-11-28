const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  findAHolidayClassListing,
  // getAllClassSchedules,
  // getClassScheduleById,
  // findAClassByVenue,
  // listTerms,
} = require("../../../controllers/admin/holidayCamps/findClass/findClassController");

// ✅ Get ALL venues + classes
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("holiday-find-class", "view-listing"),
  findAHolidayClassListing
);
// router.get(
//   "/:id",
//   authMiddleware,
//   permissionMiddleware("find-class", "view-listing"),
//   getClassScheduleById
// );
// router.get(
//   "/list",
//   authMiddleware,
//   permissionMiddleware("find-class", "view-listing"),
//   getAllClassSchedules
// );

// ✅ Get ONLY specific venue & its classes
// router.get("/venue/:venueId", authMiddleware, findAClassByVenue);
// router.get("/term-groups-with-terms", authMiddleware, listTerms);
module.exports = router;
