const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayCamp,
  getAllHolidayCamp,
  getHolidayCampById,
  updateHolidayCamp,
  deleteHolidayCamp,
} = require("../../../controllers/admin/holidayCamps/holidayCampAndDates/holidayCampController");

// ➕ Create  Camp
router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-Camp", "create"),
  createHolidayCamp
);

// 📥 Get All  Camp
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-Camp", "view-listing"),
  getAllHolidayCamp
);

// 🔍 Get  Camp by ID
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-Camp", "view-listing"),
  getHolidayCampById
);

// ✏️ Update  Camp
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-Camp", "update"),
  updateHolidayCamp
);

// 🗑️ Delete  Camp
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-Camp", "delete"),
  deleteHolidayCamp
);

module.exports = router;
