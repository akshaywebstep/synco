const webhookService = require("../../services/admin/gocardlessWebhook.service");

exports.handleWebhook = async (req, res) => {

  try {

    console.log("🔥 GoCardless Webhook Hit");

    const events = req.body.events;

    if (!events) {
      return res.status(200).json({ message: "No events received" });
    }

    for (const event of events) {
      await webhookService.processEvent(event);
    }

    return res.status(200).send("Webhook processed");

  } catch (error) {

    console.error("Webhook Error:", error);

    return res.status(500).json({
      success:false,
      message:"Webhook failed"
    });

  }

};