const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createBirthdayPartyLeads,
} = require("../../../controllers/admin/birthdayParty/birthdayPartyLeadsController");
// ✅ Create Inquery Form
router.post("/inqury-create", openParam, createBirthdayPartyLeads);

module.exports = router;
