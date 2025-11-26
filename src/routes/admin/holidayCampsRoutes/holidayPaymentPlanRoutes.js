const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createHolidayPaymentPlan,
  getAllHolidayPaymentPlans,
  getHolidayPaymentPlanById,
  updateHolidayPaymentPlan,
  deleteHolidayPaymentPlan,
} = require("../../../controllers/admin/holidayCamps/payment/holidayPaymentPlanController");

// 🔐 Create a new payment plan (Protected)
router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("holiday-payment-plan", "create"),
  createHolidayPaymentPlan
);

// 📦 Get all payment plans (Public or protect as needed)
router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("holiday-payment-plan", "view-listing"),
  getAllHolidayPaymentPlans
); // Optional: protect if required

// 📄 Get a specific payment plan by ID
router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("holiday-payment-plan", "view-listing"),
  getHolidayPaymentPlanById
);

// ✏️ Update a payment plan
router.put(
  "/update/:id",
  authMiddleware,
  permissionMiddleware("holiday-payment-plan", "update"),
  updateHolidayPaymentPlan
);

// ❌ Delete a payment plan
router.delete(
  "/delete/:id",
  authMiddleware,
  permissionMiddleware("holiday-payment-plan", "delete"),
  deleteHolidayPaymentPlan
);

module.exports = router;
