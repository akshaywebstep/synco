const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createRecruitmentFranchiseLead,
} = require("../../../controllers/admin/recruitment/franchise/franchiseRecruitmentLeadController");
// ✅ Create Inquery Form
router.post("/inqury-create", openParam, createRecruitmentFranchiseLead);

module.exports = router;
