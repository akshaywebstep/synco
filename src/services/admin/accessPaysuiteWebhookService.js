const { BookingPayment } = require("../../models");

exports.processEvent = async (event) => {
  try {
    console.log("========== APS EVENT ==========");
    console.log(JSON.stringify(event, null, 2));
    console.log("================================");

    const action = event.action;
    const paymentId = event.links?.payment;

    if (!paymentId) {
      console.log("⚠️ No paymentId received");
      return;
    }

    // status mapping
    let paymentStatus = null;
    switch (action) {
      case "created": paymentStatus = "processing"; break;
      case "submitted": paymentStatus = "pending_submission"; break;
      case "confirmed": paymentStatus = "paid"; break;
      case "failed": paymentStatus = "failed"; break;
      case "cancelled": paymentStatus = "cancelled"; break;
      default:
        console.log("⚠️ Unknown action:", action);
        return;
    }

    // ✅ Only update existing payments, do not create new
    const payment = await BookingPayment.findOne({ where: { merchantRef: paymentId } });
    if (!payment) {
      console.log("⚠️ Payment not found in DB → skipping update");
      return;
    }

    // update payment
    await payment.update({
      paymentStatus,
      gatewayResponse: event
    });

    console.log("✅ Payment Updated:", payment.id);

    // ==========================
    // CONTRACT BASED TRACKING
    // ==========================
    if (paymentStatus === "paid" && payment.contractId) {
      const nextPayment = await BookingPayment.findOne({
        where: { contractId: payment.contractId, paymentStatus: "pending" },
        order: [["createdAt", "ASC"]]
      });

      if (nextPayment) {
        await nextPayment.update({ paymentStatus: "scheduled" });
        console.log("Next payment scheduled:", nextPayment.id);
      } else {
        console.log("🎉 Contract completed");
      }
    }

  } catch (error) {
    console.error("🚨 Webhook Error:", error);
  }
};