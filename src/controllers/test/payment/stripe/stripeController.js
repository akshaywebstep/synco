
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * 🧾 Create Stripe Customer
 * Input: { name, email }
 */
const createCustomer = async ({ body }) => {
  try {
    const { name, email } = body;
    const customer = await stripe.customers.create({ name, email });
    return { success: true, customer_id: customer.id };
  } catch (error) {
    console.error("❌ createCustomer error:", error.message);
    return { success: false, msg: error.message };
  }
};

/**
 * 💳 Create Card Token (from raw card details)
 * Input: { cardNumber, expiryMonth, expiryYear, securityCode }
 */
const createCardToken = async ({ body }) => {
  try {
    const { cardNumber, expiryMonth, expiryYear, securityCode } = body;

    const token = await stripe.tokens.create({
      card: {
        number: cardNumber,
        exp_month: expiryMonth,
        exp_year: expiryYear,
        cvc: securityCode,
      },
    });

    return { success: true, token_id: token.id };
  } catch (error) {
    console.error("❌ createCardToken error:", error.message);
    return { success: false, msg: error.message };
  }
};

/**
 * 💼 Add a New Card to Customer (attach token internally)
 * Input: { customer_id, cardNumber, expiryMonth, expiryYear, securityCode }
 * It automatically creates a token (e.g. tok_visa) and attaches the card.
 */
const addNewCard = async ({ body }) => {
  try {
    const { customer_id, cardNumber, expiryMonth, expiryYear, securityCode } = body;

    if (!customer_id || !cardNumber || !expiryMonth || !expiryYear || !securityCode) {
      throw new Error("Missing required card details or customer_id");
    }

    console.log(`➡ Creating token for card ending ${cardNumber.slice(-4)}`);

    // ✅ Step 1: Create a token from the provided card details
    const token = await stripe.tokens.create({
      card: {
        number: cardNumber,
        exp_month: expiryMonth,
        exp_year: expiryYear,
        cvc: securityCode,
      },
    });

    console.log("✅ Token created successfully:", token.id);

    // ✅ Step 2: Attach that token to the customer
    const card = await stripe.customers.createSource(customer_id, {
      source: token.id,
    });

    console.log("✅ Card added successfully:", {
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
    console.error("❌ addNewCard error:", error.message);
    return { success: false, msg: error.message };
  }
};

/**
 * 💰 Create a Charge for a Customer using Card
 * Input: { amount, customer_id, card_id }
 */
const createCharges = async ({ body }) => {
  try {
    const { amount, customer_id, card_id } = body;

    const charge = await stripe.charges.create({
      amount: parseInt(amount) * 100,
      currency: "usd",
      customer: customer_id,
      source: card_id,
      description: "One-to-One Booking Payment",
      receipt_email: body.email || "tester@gmail.com",
    });

    return {
      success: true,
      charge_id: charge.id,
      status: charge.status,
    };
  } catch (error) {
    console.error("❌ createCharges error:", error.message);
    return { success: false, msg: error.message };
  }
};

module.exports = {
  createCustomer,
  createCardToken,
  addNewCard,
  createCharges,
};
