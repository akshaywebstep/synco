const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  generateWeeklyClassReport,
} = require("../../controllers/admin/weeklyClassController");

// Weekly class report route
router.get(
  "/membership-sales/report",
  authMiddleware,
  // permissionMiddleware("weekly-class", "view-report"),
  generateWeeklyClassReport
);

module.exports = router;
