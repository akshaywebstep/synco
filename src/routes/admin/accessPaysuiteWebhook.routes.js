const express = require("express");
const router = express.Router();

const webhookController = require("../../controllers/admin/accessPaysuiteWebhook.controller");

// AccessPaysuite Webhook Endpoint
router.post("/accesspaysuite", webhookController.handleWebhook);

module.exports = router;