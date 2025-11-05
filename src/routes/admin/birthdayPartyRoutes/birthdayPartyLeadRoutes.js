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

module.exports = router;
