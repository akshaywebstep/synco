const { BookingPayment, Booking } = require("../../models");

exports.processEvent = async (event) => {
  try {
    const { resource_type: resourceType, action, links } = event;
    if (resourceType !== "payments") return;

    const paymentId = links?.payment;
    const mandateId = links?.mandate;
    const subscriptionId = links?.subscription;

    console.log("🔥 GoCardless Webhook Event:", action);

    // ✅ Find existing payment by mandate + paymentId
    const paymentRecord = await BookingPayment.findOne({
      where: {
        goCardlessMandateId: mandateId,
        goCardlessPaymentId: paymentId, // ensures only existing
      },
    });

    if (!paymentRecord) {
      console.warn(`⚠️ Payment not found in DB, skipping update for mandate: ${mandateId}, payment: ${paymentId}`);
      return; // **do not create anything new**
    }

    // 🔹 Update status based on action
    switch (action) {
      case "created":
        console.log(`ℹ️ Payment already exists, no new creation for paymentId: ${paymentId}`);
        break;

      case "confirmed":
        if (paymentRecord.paymentStatus !== "paid") {
          paymentRecord.paymentStatus = "paid";
          await paymentRecord.save();
          console.log(`✅ Payment confirmed: ${paymentId} marked as PAID`);
        }
        break;

      case "failed":
        if (paymentRecord.paymentStatus !== "failed") {
          paymentRecord.paymentStatus = "failed";
          await paymentRecord.save();
          console.log(`❌ Payment failed: ${paymentId} marked as FAILED`);
        }
        break;

      default:
        console.log(`ℹ️ Unhandled action: ${action}`);
    }

  } catch (error) {
    console.error("❌ GoCardless Webhook Service Error:", error);
  }
};