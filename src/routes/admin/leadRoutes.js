const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createLead,
  getAllForFacebookLeads,
  getAllReferallLeads,
  getAllOthersLeads,
  getAllLeads,
  addCommentForLead,
  listCommentsForLead,
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
  "/findAClass",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  findAClass
);

module.exports = router;
