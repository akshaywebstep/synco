const { BookingPayment } = require("../../models");

exports.processEvent = async (event) => {

  const resourceType = event.resource_type;
  const action = event.action;
  const paymentId = event.links?.payment;

  if (resourceType !== "payments") return;

  console.log("Webhook Event:", action, paymentId);

  if (action === "confirmed") {

    await BookingPayment.update(
      { paymentStatus: "paid" },
      {
        where: { goCardlessPaymentId: paymentId }
      }
    );

  }

  if (action === "failed") {

    await BookingPayment.update(
      { paymentStatus: "failed" },
      {
        where: { goCardlessPaymentId: paymentId }
      }
    );

  }

};