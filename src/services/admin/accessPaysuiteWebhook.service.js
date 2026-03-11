const { BookingPayment } = require("../../models");

exports.processEvent = async (payload) => {
  try {

    console.log("======================================");
    console.log("📩 AccessPaySuite Webhook Payload");
    console.log(JSON.stringify(payload, null, 2));
    console.log("======================================");

    const eventType = payload.eventType;
    const contractId = payload.contractId;
    const paymentId = payload.paymentId;
    const directDebitRef = payload.directDebitReference;
    const merchantRef = payload.merchantReference;

    console.log("🔎 Event Type:", eventType);
    console.log("🔎 Contract ID:", contractId);
    console.log("🔎 Payment ID:", paymentId);
    console.log("🔎 Direct Debit Ref:", directDebitRef);
    console.log("🔎 Merchant Ref:", merchantRef);

    /*
    1️⃣ CONTRACT CREATED
    */

    if (eventType === "CONTRACT_CREATED") {

      console.log("➡️ Processing CONTRACT_CREATED");

      const result = await BookingPayment.update(
        {
          contractId: contractId,
          directDebitRef: directDebitRef,
          paymentStatus: "contract_created",
          gatewayResponse: payload
        },
        {
          where: { merchantRef: merchantRef }
        }
      );

      console.log("✅ Contract update result:", result);
    }

    /*
    2️⃣ PAYMENT GENERATED
    */

    if (eventType === "PAYMENT_GENERATED") {

      console.log("➡️ Processing PAYMENT_GENERATED");

      const parentPayment = await BookingPayment.findOne({
        where: { contractId: contractId }
      });

      if (!parentPayment) {
        console.log("❌ Parent payment not found for contractId:", contractId);
        return;
      }

      console.log("✅ Parent payment found bookingId:", parentPayment.bookingId);

      const existingPayment = await BookingPayment.findOne({
        where: { description: paymentId }
      });

      if (existingPayment) {
        console.log("⚠️ Duplicate payment event ignored:", paymentId);
        return;
      }

      await BookingPayment.create({
        bookingId: parentPayment.bookingId,
        paymentType: "accesspaysuite",
        paymentCategory: "recurring",
        price: payload.amount,
        currency: payload.currency || "GBP",
        paymentStatus: "processing",
        contractId: contractId,
        directDebitRef: directDebitRef,
        description: paymentId,
        transactionMeta: payload
      });

      console.log("✅ Recurring payment created for booking:", parentPayment.bookingId);
    }

    /*
    3️⃣ PAYMENT SUCCESS
    */

    if (eventType === "PAYMENT_SUCCESS") {

      console.log("➡️ Processing PAYMENT_SUCCESS");

      const result = await BookingPayment.update(
        {
          paymentStatus: "paid",
          gatewayResponse: payload
        },
        {
          where: { description: paymentId }
        }
      );

      console.log("✅ Payment marked PAID:", result);
    }

    /*
    4️⃣ PAYMENT FAILED
    */

    if (eventType === "PAYMENT_FAILED") {

      console.log("➡️ Processing PAYMENT_FAILED");

      const result = await BookingPayment.update(
        {
          paymentStatus: "failed",
          gatewayResponse: payload
        },
        {
          where: { description: paymentId }
        }
      );

      console.log("❌ Payment marked FAILED:", result);
    }

    console.log("🎉 Webhook processing completed");

  } catch (error) {

    console.log("🚨 Webhook Service Error");
    console.error(error);

  }
};