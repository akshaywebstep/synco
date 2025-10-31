const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * 🧾 Create Stripe Customer
 * Input: { name, email }
 */
const createCustomer = async ({ body }) => {
  try {
    const { name, email } = body;
    console.log("🔹 [Stripe] Creating Customer →", { name, email });

    const customer = await stripe.customers.create({ name, email });

    console.log("✅ [Stripe] Customer Created:", customer.id);
    return { success: true, customer_id: customer.id };
  } catch (error) {
    console.error("❌ [Stripe] createCustomer error:", error.message);
    return { success: false, msg: error.message };
  }
};

/**
 * 💳 Create Card Token (Safe Test Mode)
 * Input: (optionally cardNumber etc., but defaults to Stripe test token)
 */
const createCardToken = async ({ body }) => {
  try {
    console.log("🔹 [Stripe] Using test token 'tok_visa' (safe test mode)");
    return { success: true, token_id: "tok_visa" };
  } catch (error) {
    console.error("❌ [Stripe] createCardToken error:", error.message);
    return { success: false, msg: error.message };
  }
};

/**
 * 💼 Add a New Card to Customer
 * Input: { customer_id, card_token }
 */
const addNewCard = async ({ body }) => {
  try {
    const { customer_id, card_token } = body;
    console.log("🔹 [Stripe] Adding new card →", { customer_id, card_token });

    const card = await stripe.customers.createSource(customer_id, {
      source: card_token,
    });

    console.log("✅ [Stripe] Card Added:", {
      id: card.id,
      brand: card.brand,
      last4: card.last4,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
    });

    return {
      success: true,
      msg: "Card added successfully",
      card_id: card.id,
      brand: card.brand,
      last4: card.last4,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
    };
  } catch (error) {
    console.error("❌ [Stripe] addNewCard error:", error.message);
    return { success: false, msg: error.message };
  }
};

/**
 * 💰 Create a Charge for a Customer using Card
 * Input: { amount, customer_id, card_id, email }
 */
const createCharges = async ({ body }) => {
  try {
    const { amount, customer_id, card_id, email } = body;
    console.log("🔹 [Stripe] Creating charge →", {
      amount,
      customer_id,
      card_id,
    });

    const charge = await stripe.charges.create({
      amount: parseInt(amount) * 100, // Stripe expects cents
      currency: "usd",
      customer: customer_id,
      source: card_id,
      description: "One-to-One Booking Payment",
      receipt_email: email || "test@example.com",
    });

    console.log(
      "✅ [Stripe] Charge Successful:",
      charge.id,
      "Status:",
      charge.status
    );

    return {
      success: true,
      charge_id: charge.id,
      status: charge.status,
    };
  } catch (error) {
    console.error("❌ [Stripe] createCharges error:", error.message);
    return { success: false, msg: error.message };
  }
};

const getStripePaymentDetails = async (req, res) => {
  try {
    const { chargeId } = req.params;

    if (!chargeId) {
      return res.status(400).json({
        success: false,
        message: "Missing chargeId parameter",
      });
    }

    // 🔍 Fetch payment details from Stripe
    const charge = await stripe.charges.retrieve(chargeId);

    // ✅ Send full response back
    return res.status(200).json({
      success: true,
      chargeId: charge.id,
      amount: charge.amount / 100, // convert cents to dollars
      currency: charge.currency,
      status: charge.status,
      customer: charge.customer,
      paymentMethod: charge.payment_method_details?.card?.brand,
      last4: charge.payment_method_details?.card?.last4,
      receiptUrl: charge.receipt_url,
      fullResponse: charge, // optional full Stripe object
    });
  } catch (error) {
    console.error("❌ Error fetching Stripe charge:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch charge details",
      error: error.message,
    });
  }
};

module.exports = {
  createCustomer,
  createCardToken,
  addNewCard,
  createCharges,
  getStripePaymentDetails,
};
