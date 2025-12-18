const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createRecruitmentLead,
  getAllRecruitmentLead,
  getAllCoachAndVmRecruitmentLead,
  getRecruitmentLeadById,
  rejectRecruitmentLeadStatus,
  sendEmail,
  getAllRecruitmentLeadRport,
  getAllVenues,
  getAllVenueManager,
} = require("../../../controllers/admin/recruitment/coach/coachRecruitmentLeadController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "create"),
  createRecruitmentLead
);

router.get(
  "/listing/venue",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getAllVenues
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getAllRecruitmentLead
);

router.get(
  "/list/all",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getAllCoachAndVmRecruitmentLead
);

router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getRecruitmentLeadById
);

router.put(
  "/reject/:id",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "update"),
  rejectRecruitmentLeadStatus
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  sendEmail
);

router.get(
  "/report/",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getAllRecruitmentLeadRport
);

router.get(
  "/venue-manager/",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getAllVenueManager,
)

module.exports = router;
