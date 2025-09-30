const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");

const {
  getAllAdminRolePermissions,
  updateAdminRolePermissions,
} = require("../../controllers/admin/adminRolePermissionController");

// Base: /api/admin/roles
router.get("/", authMiddleware, getAllAdminRolePermissions);
router.put("/", authMiddleware, updateAdminRolePermissions);

module.exports = router;
