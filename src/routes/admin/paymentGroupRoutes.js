const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createPaymentGroup,
  getAllPaymentGroups,
  getPaymentGroupById,
  updatePaymentGroup,
  deletePaymentGroup,
} = require("../../controllers/admin/payment/paymentGroupController");

const {
  assignPlansToPaymentGroup,
} = require("../../controllers/admin/payment/paymentGroupHasPlanController");

// 🔐 Create a new payment group (Protected)
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("payment-group", "create"),
  createPaymentGroup
);

// 📦 Get all payment groups
router.get(
  "/",
  authMiddleware,
  permissionMiddleware("payment-group", "view-listing"),
  getAllPaymentGroups
);

// 📄 Get a specific payment group by ID
router.get(
  "/:id",
  authMiddleware,
  permissionMiddleware("payment-group", "view-listing"),
  getPaymentGroupById
);

// ✏️ Update a payment group
router.put(
  "/:id",
  authMiddleware,
  permissionMiddleware("payment-group", "update"),
  updatePaymentGroup
);

// ❌ Delete a payment group
router.delete(
  "/:id",
  authMiddleware,
  permissionMiddleware("payment-group", "delete"),
  deletePaymentGroup
);

router.post("/:id/assign-plans", authMiddleware, assignPlansToPaymentGroup);

module.exports = router;
