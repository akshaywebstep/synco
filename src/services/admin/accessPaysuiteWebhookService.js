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

    console.log("Action:", action);
    console.log("PaymentId:", paymentId);

    // status mapping
    let paymentStatus = null;

    switch (action) {

      case "created":
        paymentStatus = "processing";
        break;

      case "submitted":
        paymentStatus = "pending_submission";
        break;

      case "confirmed":
        paymentStatus = "paid";
        break;

      case "failed":
        paymentStatus = "failed";
        break;

      case "cancelled":
        paymentStatus = "cancelled";
        break;

      default:
        console.log("⚠️ Unknown action:", action);
        return;
    }

    // find payment
    const payment = await BookingPayment.findOne({
      where: { merchantRef: paymentId }
    });

    if (!payment) {
      console.log("⚠️ Payment not found in DB");
      return;
    }

    // update current payment
    await payment.update({
      paymentStatus,
      gatewayResponse: event
    });

    console.log("✅ Payment Updated:", payment.id);

    // ==========================
    // CONTRACT BASED TRACKING
    // ==========================

    if (paymentStatus === "paid" && payment.contractId) {

      console.log("Checking next payment for contract:", payment.contractId);

      const nextPayment = await BookingPayment.findOne({
        where: {
          contractId: payment.contractId,
          paymentStatus: "pending"
        },
        order: [["createdAt", "ASC"]]
      });

      if (nextPayment) {

        console.log("Next Payment Found:", nextPayment.id);

        // auto mark as ready for submission
        await nextPayment.update({
          paymentStatus: "scheduled"
        });

        console.log("Next payment scheduled");

      } else {

        console.log("🎉 Contract completed");

      }
    }

  } catch (error) {

    console.error("🚨 Webhook Error:", error);

  }

};