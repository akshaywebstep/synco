const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/admin/authenticate");

const {
  assignMultiplePermissionsToRole,
} = require("../../controllers/admin/permission/roleHasPermissionController");

// Base: /api/admin/admin/role-has-permission
router.post("/", assignMultiplePermissionsToRole);

module.exports = router;
