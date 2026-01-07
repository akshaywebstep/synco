const express = require("express");
const router = express.Router();

const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createBirthdayPartyLeads,
  getAllBirthdayPartyLeads,
  getAllBirthdayPartyLeadsSales,
  getAllBirthdayPartyLeadsSalesAll,
  getBirthdayPartyLeadsById,
  updateBirthdayPartyLeadById,
  getAllBirthdayPartyAnalytics,
  sendEmailToFirstParentWithBooking,
  cancelBirthdayPartyLeadAndBooking,
  renewBirthdayPartyLeadAndBooking,
  assignBookings,
} = require("../../../controllers/admin/birthdayParty/birthdayPartyLeadsController");

// ✅ Get All Session Plan Groups

router.post(
  "/leads/create",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "create"),
  createBirthdayPartyLeads
);

router.post(
  "/leads/send-email",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  sendEmailToFirstParentWithBooking
);

router.get(
  "/leads/list",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  getAllBirthdayPartyLeads
);

router.put(
  "/leads/assign-booking",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  assignBookings
);

router.get(
  "/sales/list",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  getAllBirthdayPartyLeadsSales
);

router.get(
  "/all/list",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  getAllBirthdayPartyLeadsSalesAll
);

router.put(
  "/booking/update/:id",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  updateBirthdayPartyLeadById
);

router.get(
  "/leads/list/:id",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  getBirthdayPartyLeadsById
);

router.get(
  "/analytics",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "view-listing"),
  getAllBirthdayPartyAnalytics
);

router.put("/cancel/:id",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "cancel-package"),
  cancelBirthdayPartyLeadAndBooking);

router.put("/renew/:id",
  authMiddleware,
  permissionMiddleware("birthday-party-lead", "renew-package"),
  renewBirthdayPartyLeadAndBooking);

module.exports = router;
