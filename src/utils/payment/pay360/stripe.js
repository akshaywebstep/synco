require("dotenv").config(); // Load .env variables
const Stripe = require("stripe");

// Initialize Stripe using your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20", // latest stable version
});

module.exports = stripe;
