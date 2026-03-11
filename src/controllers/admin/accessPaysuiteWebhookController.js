const webhookService = require("../../services/admin/accessPaysuiteWebhookService");
const { BookingPayment } = require("../../models");
const { Op } = require("sequelize");


exports.handleWebhook = async (req, res) => {

  try {

    console.log("🔥 AccessPaySuite Webhook HIT");

    let events = req.body?.events;

    // Agar payload nahi aaya to DB se generate karo
    if (!events) {

      console.log("⚠️ No payload received → Fetching payments from DB");

      const payments = await BookingPayment.findAll({
        where: {
          paymentType: "accesspaysuite",
          contractId: { [Op.ne]: null }
        },
        // limit: 10
      });

      events = payments.map(p => ({
        resource_type: "payments",
        action: "created",
        links: {
          payment: p.merchantRef
        }
      }));

      console.log("Generated Events:", JSON.stringify(events, null, 2));
    }

    for (const event of events) {
      await webhookService.processEvent(event);
    }

    res.status(200).json({
      message: "Webhook processed",
      totalEvents: events.length
    });

  } catch (error) {

    console.error("🚨 Webhook Error:", error);
    res.status(500).send("Webhook failed");

  }

};