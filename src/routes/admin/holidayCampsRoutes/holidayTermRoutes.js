const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayTerm,
  getAllHolidayTerms,
  getHolidayTermById,
  updateHolidayTerm,
  deleteHolidayTerm,
} = require("../../../controllers/admin/holidayCamps/termAndDates/holidayTermController");

// ➕ Create Term

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-term", "create"),
  createHolidayTerm
);

// 📥 Get All Terms
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-term", "view-listing"),
  getAllHolidayTerms
);

// 🔍 Get Term by ID
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-term", "view-listing"),
  getHolidayTermById
);

// ✏️ Update Term
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-term", "update"),
  updateHolidayTerm
);

// 🗑️ Delete Term
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-term", "delete"),
  deleteHolidayTerm
);

module.exports = router;
