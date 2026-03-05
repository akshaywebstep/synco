const express = require("express");
const router = express.Router();

const webhookController = require("../../controllers/admin/gocardlessWebhook.controller");

// GoCardless Webhook Endpoint
router.post("/gocardless", webhookController.handleWebhook);

module.exports = router;