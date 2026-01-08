const express = require("express");
const router = express.Router();
const openParam = require("../../../middleware/open");

const {
  createOnetoOneLeads,
} = require("../../../controllers/admin/oneToOne/oneToOneLeadsController");
// ✅ Create Inquery Form
router.post("/inqury-create", openParam, createOnetoOneLeads);

module.exports = router;
