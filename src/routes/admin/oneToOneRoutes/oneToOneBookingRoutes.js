const express = require("express");
const router = express.Router();

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createOnetoOneBooking,
  getAdminsPaymentPlanDiscount,
} = require("../../../controllers/admin/oneToOne/booking/oneToOneBookingController");

// ✅ Get All Session Plan Groups

router.post(
  "/booking/create",
  authMiddleware,
  permissionMiddleware("one-to-one-lead", "create"),
  createOnetoOneBooking
);

router.get(
  "/getAllData",
  authMiddleware,
  permissionMiddleware("one-to-one-lead", "view-listing"),
  getAdminsPaymentPlanDiscount
);

module.exports = router;
