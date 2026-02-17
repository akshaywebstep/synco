const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayCampDates,
  getAllHolidayCampDates,
  getHolidayCampDatesById,
  updateHolidayCampDates,
  deleteHolidayCampDates,
} = require("../../../controllers/admin/holidayCamps/holidayCampAndDates/holidayCampDatesController");

// ➕ Create Camp

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-camp", "create"),
  createHolidayCampDates
);

// 📥 Get All Camps
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-camp", "view-listing"),
  getAllHolidayCampDates
);

// 🔍 Get Camp by ID
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-camp", "view-listing"),
  getHolidayCampDatesById
);

// ✏️ Update Camp
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-camp", "update"),
  updateHolidayCampDates
);

// 🗑️ Delete Camp
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-camp", "delete"),
  deleteHolidayCampDates
);

module.exports = router;
