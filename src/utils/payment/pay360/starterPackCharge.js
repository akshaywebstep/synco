const stripePromise = require("./stripe");

module.exports = async function chargeStarterPack({
  name,
  email,
  starterPack,
}) {
  console.log("🟡 ===== STRIPE STARTER PACK CHARGE START =====");

  try {
    console.log("🟡 Input name:", name);
    console.log("🟡 Input email:", email);
    console.log("🟡 StarterPack object:", starterPack);

    if (!starterPack) {
      console.log("🔴 Starter pack missing");
      throw new Error("Starter pack missing");
    }

    const stripe = await stripePromise;
    console.log("🟢 Stripe instance loaded");

    const amount = Number(starterPack.price);
    console.log("🟡 Starter pack price:", starterPack.price);
    console.log("🟡 Converted amount:", amount);

    if (!amount || amount <= 0) {
      console.log("🔴 Invalid starter pack amount");
      throw new Error("Invalid starter pack amount");
    }

    const cleanName = name?.trim();
    const cleanEmail = email?.trim().toLowerCase();

    console.log("🟡 Creating PaymentIntent...");

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "gbp",

      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },

      payment_method: "pm_card_visa", // test
      confirm: true,

      description: starterPack.title || "Starter Pack",
      receipt_email: cleanEmail,
    });

    console.log("🟢 PaymentIntent created:", paymentIntent.id);
    console.log("🟢 Payment status:", paymentIntent.status);

    console.log("🟢 ===== STRIPE STARTER PACK SUCCESS =====");

    return {
      status: true,
      paymentIntentId: paymentIntent.id, // 👈 yahi save karna DB me
      amount,
      raw: paymentIntent,
    };
  } catch (err) {
    console.log("🔴 ===== STRIPE STARTER PACK ERROR =====");
    console.log("🔴 Error message:", err.message);
    console.log("🔴 Full error:", err);

    return {
      status: false,
      message: err.message,
    };
  }
};