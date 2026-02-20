const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createStarterPack,
  getAllStarterPack,
  getStarterPackById,
  updateStarterPack,
  deleteStarterPack,
} = require("../../controllers/admin/payment/starterPackController");

// 🔐 Create a new starter pack 
router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("starter-pack", "create"),
  createStarterPack
);

// 📦 Get all starter pack 
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("starter-pack", "view-listing"),
  getAllStarterPack
); 

// 📄 Get a specific starter pack by ID
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("starter-pack", "view-listing"),
  getStarterPackById
);

// ✏️ Update a starter pack
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("starter-pack", "update"),
  updateStarterPack
);

// ❌ Delete a starter pack
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("starter-pack", "delete"),
  deleteStarterPack
);

module.exports = router;
