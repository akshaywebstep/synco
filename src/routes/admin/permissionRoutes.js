const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");

const {
  getAllAdminPermissions,
  getAdminPermissionById,
  updateAdminPermissionStatus,
} = require("../../controllers/admin/adminPermissionController");

// Base: /api/admin/roles
router.get("/", authMiddleware, getAllAdminPermissions); // ✅ Get all roles
router.get("/:id", authMiddleware, getAdminPermissionById); // ✅ Get role by ID
router.patch("/:id/status", authMiddleware, updateAdminPermissionStatus); // ✅ Update status (true/false)

module.exports = router;
