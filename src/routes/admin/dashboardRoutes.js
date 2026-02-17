const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  dashboardStats,
  getDashboardWidgets,
  updateDashboardWidgets,
} = require("../../controllers/admin/dashboardController");

router.get(
  "/stats",
  authMiddleware,
  permissionMiddleware("dashboard", "view-listing"),
  dashboardStats
);

// Get all widgets for the admin
router.get(
  "/widgets",
  authMiddleware,
  permissionMiddleware("dashboard", "view-listing"),
  getDashboardWidgets
);

// Update order & visibility
router.put(
  "/widgets",
  authMiddleware,
  permissionMiddleware("dashboard", "view-listing"),
  updateDashboardWidgets
);

module.exports = router;
