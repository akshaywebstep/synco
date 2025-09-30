const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createAdminRole,
  getAllAdminRoles,
  getAdminRoleById,
  updateAdminRole,
  deleteAdminRole,
} = require("../../controllers/admin/adminRoleController");

// Base: /api/admin/admin/role
router.use("/permission", require("./rolePermissionRoutes"));

// Create role → needs "create" permission on "admin-role"
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("admin-role", "create"),
  createAdminRole
);

// Get all roles → needs "view-listing" permission on "admin-role"
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("admin-role", "view-listing"),
  getAllAdminRoles
);

// Get role by ID → needs "view-listing" permission
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("admin-role", "view-listing"),
  getAdminRoleById
);

// Update role → needs "update" permission
router.put(
  "/:id",
  authMiddleware,
  permissionMiddleware("admin-role", "update"),
  updateAdminRole
);

// Delete role → needs "delete" permission
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("admin-role", "delete"),
  deleteAdminRole
);

module.exports = router;
