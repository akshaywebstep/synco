const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createDiscount,
  getAllDiscounts,
} = require("../../controllers/admin/discountController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("discount", "create"),
  createDiscount
);

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("discount", "view-listing"),
  getAllDiscounts
);

module.exports = router;
