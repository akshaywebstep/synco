const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createTermGroup,
  getAllGroups,
  getGroupById,
  updateGroup,
  deleteGroup,
} = require("../../controllers/admin/termAndDates/termGroupController");

// ➕ Create Term Group
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("term-group", "create"),
  createTermGroup
);

// 📥 Get All Term Groups
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("term-group", "view-listing"),
  getAllGroups
);

// 🔍 Get Term Group by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("term-group", "view-listing"),
  getGroupById
);

// ✏️ Update Term Group
router.put(
  "/:id",
  authMiddleware,
  permissionMiddleware("term-group", "update"),
  updateGroup
);

// 🗑️ Delete Term Group
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("term-group", "delete"),
  deleteGroup
);

module.exports = router;
