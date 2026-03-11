const { BookingPayment, Booking } = require("../../models");

exports.processEvent = async (event) => {
  try {
    const { resource_type: resourceType, action, links } = event;
    if (resourceType !== "payments") return;

    const paymentId = links?.payment;
    const mandateId = links?.mandate;
    const subscriptionId = links?.subscription;

    console.log("🔥 GoCardless Webhook Event:", action);

    // Parent payment by mandate
    const parentPayment = await BookingPayment.findOne({
      where: { goCardlessMandateId: mandateId },
    });
    if (!parentPayment) {
      console.warn(`⚠️ Parent payment not found for mandate: ${mandateId}`);
      return;
    }

    // Prevent duplicate payments
    const existingPayment = await BookingPayment.findOne({
      where: { goCardlessPaymentId: paymentId },
    });
    if (existingPayment) {
      console.log(`⚠️ Duplicate GoCardless payment ignored: ${paymentId}`);
      return;
    }

    switch (action) {
      case "created":
        console.log(`🔥 Creating payment record for bookingId: ${parentPayment.bookingId}`);

        // Create payment using parent payment details
        await BookingPayment.create({
          bookingId: parentPayment.bookingId,
          firstName: parentPayment.firstName,
          lastName: parentPayment.lastName,
          email: parentPayment.email,
          paymentType: "bank",
          paymentCategory: parentPayment.paymentCategory || "recurring",
          price: parentPayment.price,
          currency: parentPayment.currency,
          paymentStatus: "processing",
          goCardlessPaymentId: paymentId,
          goCardlessMandateId: mandateId,
          goCardlessSubscriptionId: subscriptionId,
        });

        console.log(`✅ Payment created for bookingId: ${parentPayment.bookingId}`);
        break;

      case "confirmed":
        await BookingPayment.update(
          { paymentStatus: "paid" },
          { where: { goCardlessPaymentId: paymentId } }
        );
        console.log(`✅ Payment confirmed: ${paymentId} marked as PAID`);
        break;

      case "failed":
        await BookingPayment.update(
          { paymentStatus: "failed" },
          { where: { goCardlessPaymentId: paymentId } }
        );
        console.log(`❌ Payment failed: ${paymentId} marked as FAILED`);
        break;

      default:
        console.log(`ℹ️ Unhandled action: ${action}`);
    }
  } catch (error) {
    console.error("❌ GoCardless Webhook Service Error:", error);
  }
};