const express = require("express");
const router = express.Router();

const webhookController = require("../../controllers/admin/accessPaysuiteWebhookController");

// AccessPaysuite Webhook Endpoint
router.post("/accesspaysuite", webhookController.handleWebhook);

module.exports = router;