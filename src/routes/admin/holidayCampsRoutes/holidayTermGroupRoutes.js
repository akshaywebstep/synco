const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHoliayTermGroup,
  getAllHolidayGroups,
  getHolidayGroupById,
  updateHolidayGroup,
  deleteHolidayGroup,
} = require("../../../controllers/admin/holidayCamps/termAndDates/holidayTermGroupController");

// ➕ Create Term Group
router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-term-group", "create"),
  createHoliayTermGroup
);

// 📥 Get All Term Groups
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-term-group", "view-listing"),
  getAllHolidayGroups
);

// 🔍 Get Term Group by ID
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-term-group", "view-listing"),
  getHolidayGroupById
);

// ✏️ Update Term Group
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-term-group", "update"),
  updateHolidayGroup
);

// 🗑️ Delete Term Group
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-term-group", "delete"),
  deleteHolidayGroup
);

module.exports = router;
