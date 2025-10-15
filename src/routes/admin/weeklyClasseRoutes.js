const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const memberController = require("../../controllers/admin/weeklyClass/analytics/memberController");
const freeTrialController = require("../../controllers/admin/weeklyClass/analytics/freeTrialController");
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
  "/analytics/free-trial",
  authMiddleware,
  // permissionMiddleware("weekly-class", "view-report"),
  freeTrialController.getMonthlyReport
);

// Weekly class report route
router.get(
  "/analytics/sale",
  authMiddleware,
  // permissionMiddleware("weekly-class", "view-report"),
  saleController.getMonthlyReport
);

module.exports = router;
