const express = require("express");
const router = express.Router();
const bodyParser = require("body-parser"); // ✅ needed for raw body

const webhookController = require("../../controllers/admin/gocardlessWebhook.controller");

// GoCardless Webhook Endpoint
router.post(
  "/gocardless",
  bodyParser.raw({ type: "application/json" }), // 👈 raw body middleware
  webhookController.handleWebhook
);

module.exports = router;