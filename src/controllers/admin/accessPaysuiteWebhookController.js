const webhookService = require("../../services/admin/accessPaysuiteWebhookService");
const { BookingPayment } = require("../../models");
const { Op } = require("sequelize");


exports.handleWebhook = async (req, res) => {
  try {
    console.log("🔥 AccessPaySuite Webhook HIT");

    const events = req.body?.events;

    if (!events || events.length === 0) {
      console.log("⚠️ No events received → Ignoring webhook");
      return res.status(200).json({ message: "No events received" });
    }

    for (const event of events) {
      await webhookService.processEvent(event);
    }

    res.status(200).json({
      message: "Webhook processed",
      totalEvents: events.length,
    });

  } catch (error) {
    console.error("🚨 Webhook Error:", error);
    res.status(500).send("Webhook failed");
  }
};