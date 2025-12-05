const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createVmRecruitmentLead,
  getAllVmRecruitmentLead,
  getVmRecruitmentLeadById,
  rejectRecruitmentLeadStatus,
  sendEmail,
} = require("../../../controllers/admin/recruitment/venueManager/vmRecruitmentLeadController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("recruitment-coach-lead-venue-manager", "create"),
  createVmRecruitmentLead
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("recruitment-coach-lead-venue-manager", "view-listing"),
  getAllVmRecruitmentLead
);

router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("recruitment-coach-lead-venue-manager", "view-listing"),
  getVmRecruitmentLeadById
);

router.put(
  "/reject/:id",
  authMiddleware,
  permissionMiddleware("recruitment-coach-lead-venue-manager", "update"),
  rejectRecruitmentLeadStatus
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("recruitment-coach-lead-venue-manager", "view-listing"),
  sendEmail
);

module.exports = router;
