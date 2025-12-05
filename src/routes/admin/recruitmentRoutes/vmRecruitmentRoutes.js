const express = require("express");
const router = express.Router();
const authMiddleware = require("../../../middleware/admin/authenticate");
const permissionMiddleware = require("../../../middleware/admin/permission");

const {
  createVmRecruitmentLead,
  getAllVmRecruitmentLead,
  getVmRecruitmentLeadById,
} = require("../../../controllers/admin/recruitment/venueManager/vmRecruitmentLeadController");

router.post(
  "/create",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "create"),
  createVmRecruitmentLead
);

router.get(
  "/list",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getAllVmRecruitmentLead
);

router.get(
  "/listBy/:id",
  authMiddleware,
  permissionMiddleware("recruitment-lead", "view-listing"),
  getVmRecruitmentLeadById
);

module.exports = router;
