const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createRecruitmentLead,
  getAllRecruitmentLead,
  getRecruitmentLeadById,
  rejectRecruitmentLeadStatus,
  sendEmail,
} = require("../../../controllers/admin/recruitment/coach/coachRecruitmentLeadController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "create"),
  createRecruitmentLead
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getAllRecruitmentLead
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

module.exports = router;
