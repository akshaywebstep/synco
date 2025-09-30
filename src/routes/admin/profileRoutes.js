const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const { profile } = require("../../controllers/admin/authController");

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("profile", "view-listing"),
  profile
);

module.exports = router;
