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

      // Parent payment find karo mandateId se
      const parentPayment = await BookingPayment.findOne({
        where: { goCardlessMandateId: mandateId }
      });

      if (!parentPayment) return;

      // 🔹 IDENTITY CHECK: Agar paymentId already hai, duplicate na create ho
      const existingPayment = await BookingPayment.findOne({
        where: { goCardlessPaymentId: paymentId }
      });

      if (existingPayment) {
        console.log(`Duplicate event ignored for goCardlessPaymentId: ${paymentId}`);
        return; // ignore duplicate
      }

      // 🔹 Agar duplicate nahi hai, nayi row create karo
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

      console.log(`Recurring payment created for bookingId: ${parentPayment.bookingId}, paymentId: ${paymentId}`);
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