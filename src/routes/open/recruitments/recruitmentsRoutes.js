const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createRecruitmentFranchiseLead,
} = require("../../../controllers/admin/recruitment/franchise/franchiseRecruitmentLeadController");
const {
  createRecruitmentLead,
  createWebsiteCoachLead,
} = require("../../../controllers/admin/recruitment/coach/coachRecruitmentLeadController");

const {
  createWebsiteVmLead,
} = require("../../../controllers/admin/recruitment/venueManager/vmRecruitmentLeadController");
// ✅ Create Inquery Form
router.post(
  "/franchise/inqury-create",
  openParam,
  createRecruitmentFranchiseLead
);
router.post("/coach/inqury-create", openParam, createRecruitmentLead);
router.post("/coach/candidate-profile", openParam, createWebsiteCoachLead);
router.post("/venue-manager/candidate-profile", openParam, createWebsiteVmLead);

module.exports = router;
