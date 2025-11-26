const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayPaymentGroup,
  getAllHolidayPaymentGroups,
  getHolidayPaymentGroupById,
  updateHolidayPaymentGroup,
  deleteHolidayPaymentGroup,
} = require("../../../controllers/admin/holidayCamps/payment/holidayPaymentGroupController");

const {
  assignPlansToPaymentGroup,
} = require("../../../controllers/admin/holidayCamps/payment/holidayPaymentGroupHasPlanController");

// 🔐 Create a new payment group (Protected)
router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-payment-group", "create"),
  createHolidayPaymentGroup
);

// 📦 Get all payment groups
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-payment-group", "view-listing"),
  getAllHolidayPaymentGroups
);

// 📄 Get a specific payment group by ID
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-payment-group", "view-listing"),
  getHolidayPaymentGroupById
);

// ✏️ Update a payment group
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-payment-group", "update"),
  updateHolidayPaymentGroup
);

// ❌ Delete a payment group
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-payment-group", "delete"),
  deleteHolidayPaymentGroup
);

router.post("/:id/assign-plans", authMiddleware, assignPlansToPaymentGroup);

module.exports = router;
