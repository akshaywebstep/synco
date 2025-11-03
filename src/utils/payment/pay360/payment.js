const { AppConfig } = require("../../../models");
const DEBUG = process.env.DEBUG === "true";
const GOCARDLESS_API = "https://api-sandbox.gocardless.com";
const API_VERSION = "2015-07-06";

/**
 * Build GoCardless request headers
 * @param {string} accessToken - GoCardless Access Token (fetched from AppConfig)
 */
function buildHeaders(accessToken) {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("Authorization", `Bearer ${accessToken}`);
  headers.append("GoCardless-Version", API_VERSION);
  return headers;
}

/**
 * Get GoCardless Access Token from AppConfig
 */
async function getGoCardlessAccessToken() {
  const config = await AppConfig.findOne({
    where: { key: "GOCARDLESS_ACCESS_TOKEN" },
  });
  if (!config || !config.value) {
    throw new Error("Missing GOCARDLESS_ACCESS_TOKEN in AppConfig.");
  }
  return config.value;
}

/**
 * Handle GoCardless API response safely
 */
async function handleResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorDetails = JSON.stringify(result, null, 2);
    console.error("❌ API Error:", errorDetails);
    return { status: false, error: result };
  }
  return { status: true, data: result };
}

/**
 * Create a GoCardless Billing Request (Payment + Mandate + Bank Account)
 */
async function createBillingRequest({
  customerId,
  description,
  amount,
  currency = "GBP", // default currency
  accountHolderName,
  accountNumber,
  branchCode,
  reference,
  mandateReference,
  metadata = {},
  fallbackEnabled = true,
  countryCode = "GB", // default country
}) {
  try {
    if (DEBUG) console.log("🔹 [Payment] Step 1: Preparing request body...");

    // ✅ Fetch access token from AppConfig
    const accessToken = await getGoCardlessAccessToken();

    // Payload includes both billing request and customer bank account
    const body = {
      billing_requests: {
        payment_request: {
          description,
          amount,
          scheme: "faster_payments",
          currency,
          metadata,
        },
        mandate_request: {
          currency,
          scheme: "bacs",
          verify: "recommended",
          metadata,
        },
        links: { customer: customerId },
        metadata,
      },
      customer_bank_accounts: {
        account_holder_name: accountHolderName,
        account_number: accountNumber,
        branch_code: branchCode,
        country_code: countryCode, // MUST be valid (e.g., 'GB')
        currency, // MUST match payment currency
        links: { customer: customerId },
      },
    };

    if (DEBUG) console.log("✅ Request body:", body);

    // Send request to GoCardless
    if (DEBUG)
      console.log("🔹 [Payment] Step 2: Sending request to GoCardless...");
    const response = await fetch(`${GOCARDLESS_API}/billing_requests`, {
      method: "POST",
      headers: buildHeaders(accessToken), // ✅ fixed here
      body: JSON.stringify(body),
    });

    const { status, data, error } = await handleResponse(response);
    if (!status) {
      return {
        status: false,
        message:
          "Failed to create billing request. Please check details and try again.",
        error,
      };
    }

    if (DEBUG)
      console.log("✅ Billing request created successfully:", data);

    return {
      status: true,
      message: "Billing request created successfully.",
      billingRequest: data.billing_requests,
    };
  } catch (err) {
    console.error("❌ Error creating billing request:", err.message);
    return {
      status: false,
      message:
        "An unexpected error occurred while creating the billing request.",
      error: err.message,
    };
  }
}

module.exports = { createBillingRequest };
