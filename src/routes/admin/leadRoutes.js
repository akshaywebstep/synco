const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/admin/authenticate");
const permissionMiddleware = require("../../middleware/admin/permission");

const {
  createLead,
  getAllLeads,
  getAllWaitingListBookings,
} = require("../../controllers/admin/lead/leadsController");

router.post(
  "/",
  authMiddleware,
  permissionMiddleware("lead", "create"),
  createLead
);

router.get(
  "/",
  authMiddleware,
  permissionMiddleware("lead", "view-listing"),
  getAllLeads
);

module.exports = router;
