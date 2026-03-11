const webhookService = require("../../services/admin/accessPaysuiteWebhook.service");

exports.handleWebhook = async (req, res) => {

  try {

    console.log("🔥 AccessPaySuite Webhook HIT");
    console.log("Headers:", req.headers);

    console.log("Body:");
    console.log(JSON.stringify(req.body, null, 2));

    await webhookService.processEvent(req.body);

    res.status(200).send("Webhook received");

  } catch (error) {

    console.error("Webhook Error:", error);

    res.status(500).json({
      success:false,
      message:"Webhook failed"
    });

  }

};