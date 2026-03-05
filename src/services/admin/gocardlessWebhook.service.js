const { BookingPayment } = require("../../models");

exports.processEvent = async (event) => {
  try {

    const resourceType = event.resource_type;
    const action = event.action;

    const paymentId = event.links?.payment;
    const mandateId = event.links?.mandate;
    const subscriptionId = event.links?.subscription;

    if (resourceType !== "payments") return;

    console.log("Webhook Event:", action);

    /*
    1️⃣ Payment Created
    */
    if (action === "created") {

      const parentPayment = await BookingPayment.findOne({
        where: { goCardlessMandateId: mandateId }
      });

      if (!parentPayment) return;

      await BookingPayment.create({
        bookingId: parentPayment.bookingId,
        paymentType: "bank",
        paymentCategory: "recurring",
        price: parentPayment.price,
        currency: parentPayment.currency,
        paymentStatus: "processing",
        goCardlessPaymentId: paymentId,
        goCardlessMandateId: mandateId,
        goCardlessSubscriptionId: subscriptionId
      });

      console.log("Recurring payment created");

    }

    /*
    2️⃣ Payment Confirmed
    */
    if (action === "confirmed") {

      await BookingPayment.update(
        { paymentStatus: "paid" },
        {
          where: { goCardlessPaymentId: paymentId }
        }
      );

      console.log("Payment marked as PAID");

    }

    /*
    3️⃣ Payment Failed
    */
    if (action === "failed") {

      await BookingPayment.update(
        { paymentStatus: "failed" },
        {
          where: { goCardlessPaymentId: paymentId }
        }
      );

      console.log("Payment marked as FAILED");

    }

  } catch (error) {
    console.error("Webhook Service Error:", error);
  }
};