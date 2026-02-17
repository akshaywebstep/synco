const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createRecruitmentFranchiseLead,
  getAllFranchiseRecruitmentLead,
  getFranchiseRecruitmentLeadById,
  rejectFranchiseRecruitmentStatusById,
  sendEmail,
  sendOfferEmail,
  getAllFranchiseRecruitmentLeadRport,
} = require("../../../controllers/admin/recruitment/franchise/franchiseRecruitmentLeadController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "create"),
  createRecruitmentFranchiseLead
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "view-listing"),
  getAllFranchiseRecruitmentLead
);

router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "view-listing"),
  getFranchiseRecruitmentLeadById
);

router.put(
  "/reject/:id",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "update"),
  rejectFranchiseRecruitmentStatusById
);

router.post(
  "/send-email",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "view-listing"),
  sendEmail
);

router.post(
  "/send-email/offer",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "view-listing"),
  sendOfferEmail
);

router.get(
  "/report/",
  authMiddleware,
  permissionMiddleware("recruitment-lead-franchise", "view-listing"),
  getAllFranchiseRecruitmentLeadRport
);

module.exports = router;
