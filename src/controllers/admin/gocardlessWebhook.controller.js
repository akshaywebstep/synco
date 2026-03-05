const webhookService = require("../../services/admin/gocardlessWebhook.service");

exports.handleWebhook = async (req, res) => {
  try {

    const events = req.body.events;

    if (!events) {
      return res.status(200).json({ message: "No events received" });
    }

    for (const event of events) {
      await webhookService.processEvent(event);
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully"
    });

  } catch (error) {

    console.error("Webhook Controller Error:", error);

    return res.status(500).json({
      success: false,
      message: "Webhook processing failed"
    });

  }
};
