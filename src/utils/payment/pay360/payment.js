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
async function getGoCardlessAccessToken(overrideToken = null) {
  if (overrideToken) return overrideToken;

  const config = await AppConfig.findOne({
    where: { key: "GC_HEAD_OFFICE_TOKEN" },
  });

  if (!config?.value) throw new Error("Missing GC token");
  return config.value;
}

/**
 * Handle GoCardless API response safely
 */
async function handleResponse(response) {
  let result = {};
  try {
    result = await response.json();
  } catch {
    result = {};
  }

  if (!response.ok) {
    let message = "GoCardless request failed";

    // ✅ GoCardless standard error format
    if (result?.error) {
      if (result.error.message) {
        message = result.error.message;
      }

      if (Array.isArray(result.error.errors) && result.error.errors.length) {
        message = result.error.errors
          .map(e => `${e.field}: ${e.message}`)
          .join(", ");
      }
    }

    console.error("❌ GoCardless API Error:", message);

    return {
      status: false,
      message,
      error: result,
    };
  }

  return { status: true, data: result };
}

// async function handleResponse(response) {
//   const result = await response.json().catch(() => ({}));
//   if (!response.ok) {
//     const errorDetails = JSON.stringify(result, null, 2);
//     console.error("❌ API Error:", errorDetails);
//     return { status: false, error: result };
//   }
//   return { status: true, data: result };
// }

/**
 * Create a GoCardless Billing Request (Payment + Mandate + Bank Account)
 */
async function createBillingRequest(payload, overrideToken = null) {
  try {
    if (DEBUG) console.log("🔹 [Payment] Step 1: Preparing request body...");

    const accessToken = overrideToken || await getGoCardlessAccessToken();

    // ✅ Proper payload destructuring
    const {
      description,
      amount,
      currency = "GBP",
      metadata = {},
      customerId,
      account_holder_name,
      account_number,
      branch_code,
      country_code = "GB",
    } = payload;

    if (!customerId) throw new Error("customerId is required");
    if (!amount) throw new Error("amount is required");

    const body = {
      billing_requests: {
        payment_request: {
          description,
          amount,
          currency,
          scheme: "faster_payments",
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

      // ⚠️ Only include bank account if provided
      ...(account_number && branch_code
        ? {
            customer_bank_accounts: {
              account_holder_name,
              account_number,
              branch_code,
              country_code,
              links: { customer: customerId },
            },
          }
        : {}),
    };

    if (DEBUG) console.log("✅ Request body:", body);

    if (DEBUG)
      console.log("🔹 [Payment] Step 2: Sending request to GoCardless...");

    const response = await fetch(`${GOCARDLESS_API}/billing_requests`, {
      method: "POST",
      headers: buildHeaders(accessToken),
      body: JSON.stringify(body),
    });

    const { status, data, message, error } = await handleResponse(response);

    if (!status) {
      return { status: false, message, error };
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
      message: "An unexpected error occurred while creating billing request.",
      error: err.message,
    };
  }
}

// Create mandates
async function createMandate({ customer_bank_account_id }, overrideToken = null) {
  try {
    const token = await getGoCardlessAccessToken(overrideToken);

    const body = {
      mandates: {
        scheme: "bacs",
        links: { customer_bank_account: customer_bank_account_id },
      },
    };

    const response = await fetch(`${GOCARDLESS_API}/mandates`, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(body),
    });

    const { status, data, message } = await handleResponse(response);
    if (!status) return { status: false, message };

    return { status: true, mandate: data.mandates };
  } catch (err) {
    return { status: false, message: err.message };
  }
}

// create payment
async function createPayment(
  { mandateId, amount, currency = "GBP", description },
  overrideToken = null
) {
  try {
    const token = await getGoCardlessAccessToken(overrideToken);

    const body = {
      payments: {
        amount,
        currency,
        description,
        links: { mandate: mandateId },
      },
    };

    const response = await fetch(`${GOCARDLESS_API}/payments`, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(body),
    });

    const { status, data, message } = await handleResponse(response);
    if (!status) return { status: false, message };

    return { status: true, payment: data.payments };
  } catch (err) {
    return { status: false, message: err.message };
  }
}

module.exports = { createBillingRequest, createPayment, createMandate };
