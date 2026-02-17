const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createLead,
  getAllForFacebookLeads,
  registerFacebookLeads,
  syncFacebookLeads,
  getAllReferallLeads,
  getAllOthersLeads,
  getAllLeads,
  addCommentForLead,
  listCommentsForLead,
  getLeadandBookingDatabyLeadId,
  sendSelectedLeadListEmail,
  // getAllWaitingListBookings,
  findAClass
} = require("../../controllers/admin/lead/leadsController");

router.post(
  "/comment/create",
  authMiddleware,
  permissionMiddleware("comment", "create"),
  addCommentForLead
);

router.get(
  "/comment/list",
  authMiddleware,
  permissionMiddleware("comment", "view-listing"),
  listCommentsForLead
);

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("lead", "create"),
  createLead
);

router.get(
  "/facebook",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  getAllForFacebookLeads
);

router.get(
  "/facebook/webhook",
  registerFacebookLeads
);

router.post(
  "/facebook/webhook",
  syncFacebookLeads
);

router.get(
  "/referall",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  getAllReferallLeads
);

router.get(
  "/allOthers",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  getAllOthersLeads
);

router.get(
  "/all",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  getAllLeads
);

router.get(
  "/:leadId",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  getLeadandBookingDatabyLeadId
);

router.get(
  "/findAClass",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  findAClass
);

// 📧 Send trial confirmation emails
router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  sendSelectedLeadListEmail
);

module.exports = router;
