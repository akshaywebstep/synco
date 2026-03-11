const webhookService = require("../../services/admin/gocardlessWebhook.service");
const { BookingPayment } = require("../../models");
const { Op } = require("sequelize");

exports.handleWebhook = async (req, res) => {
  try {
    console.log("🔥 GoCardless Webhook HIT");

    let events = null;

    // Agar raw JSON body mili to parse karo
    if (Buffer.isBuffer(req.body)) {
      events = JSON.parse(req.body.toString())?.events;
    } else {
      events = req.body?.events;
    }

    // Agar payload nahi aaya to DB se generate karo
    if (!events || events.length === 0) {
      console.log("⚠️ No payload received → Fetching payments from DB");

      const payments = await BookingPayment.findAll({
        where: {
          paymentType: "bank",
          goCardlessMandateId: { [Op.ne]: null },
        },
        // optional limit for testing
        // limit: 20,
      });

      events = payments.map((p) => ({
        resource_type: "payments",
        action: "created",
        links: {
          payment: p.goCardlessPaymentId || p.merchantRef,
          mandate: p.goCardlessMandateId,
          subscription: p.goCardlessSubscriptionId,
        },
      }));

      console.log("Generated Events from DB:", JSON.stringify(events, null, 2));
    }

    // Process each event
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