const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const memberController = require("../../controllers/admin/weeklyClass/analytics/memberController");
const freeTrailController = require("../../controllers/admin/weeklyClass/analytics/freeTrailController");
const saleController = require("../../controllers/admin/weeklyClass/analytics/saleController");

// Weekly class report route
router.get(
  "/analytics/member",
  authMiddleware,
  // permissionMiddleware("weekly-class", "view-report"),
  memberController.getMonthlyReport
);

// Weekly class report route
router.get(
  "/analytics/free-trail",
  authMiddleware,
  // permissionMiddleware("weekly-class", "view-report"),
  freeTrailController.getMonthlyReport
);

// Weekly class report route
router.get(
  "/analytics/sale",
  authMiddleware,
  // permissionMiddleware("weekly-class", "view-report"),
  saleController.getMonthlyReport
);

module.exports = router;
