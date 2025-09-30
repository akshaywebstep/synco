const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createPaymentPlan,
  getAllPaymentPlans,
  getPaymentPlanById,
  updatePaymentPlan,
  deletePaymentPlan,
} = require("../../controllers/admin/payment/paymentPlanController");

// 🔐 Create a new payment plan (Protected)
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("payment-plan", "create"),
  createPaymentPlan
);

// 📦 Get all payment plans (Public or protect as needed)
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("payment-group", "view-listing"),
  getAllPaymentPlans
); // Optional: protect if required

// 📄 Get a specific payment plan by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("payment-group", "view-listing"),
  getPaymentPlanById
);

// ✏️ Update a payment plan
router.put(
  "/:id",
  authMiddleware,
  permissionMiddleware("payment-group", "update"),
  updatePaymentPlan
);

// ❌ Delete a payment plan
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("payment-group", "delete"),
  deletePaymentPlan
);

module.exports = router;
