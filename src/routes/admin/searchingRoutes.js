const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const { globalSearch } = require("../../controllers/admin/searchController");

// Global Search Route
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("search", "view-listing"),
  globalSearch
);

module.exports = router;
