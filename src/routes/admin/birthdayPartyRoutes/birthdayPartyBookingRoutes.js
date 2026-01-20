const express = require("express");
const router = express.Router();

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createBirthdayPartyBooking,
  getAdminsPaymentPlanDiscount,
  sendBookingSMSToParents,
} = require("../../../controllers/admin/birthdayParty/booking/birthdayPartyBookingController");

// ✅ Get All Session Plan Groups

router.post(
  "/booking/create",
  authMiddleware,
  permissionMiddleware("birthday-party-booking", "create"),
  createBirthdayPartyBooking
);

router.get(
  "/getAllData",
  authMiddleware,
  permissionMiddleware("birthday-party-booking", "view-listing"),
  getAdminsPaymentPlanDiscount
);

router.post(
  "/booking/send-text",
  authMiddleware,
  sendBookingSMSToParents
);

module.exports = router;
