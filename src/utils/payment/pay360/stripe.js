const Stripe = require("stripe");
const { AppConfig } = require("../../../models"); // adjust path as needed

// 🔹 Export a promise that resolves to a fully initialized Stripe instance
const stripePromise = (async () => {
  try {
    // Fetch key from AppConfig
    const config = await AppConfig.findOne({ where: { key: "STRIPE_SECRET_KEY" } });
    if (!config || !config.value) {
      throw new Error("Missing STRIPE_SECRET_KEY in AppConfig.");
    }

    // Initialize Stripe with the latest API version
    const stripe = new Stripe(config.value, { apiVersion: "2024-06-20" });
    console.log("✅ Stripe initialized successfully.");
    return stripe;
  } catch (error) {
    console.error("❌ Failed to initialize Stripe:", error.message);
    throw error;
  }
})();

module.exports = stripePromise;
