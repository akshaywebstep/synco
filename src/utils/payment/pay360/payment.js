const { AppConfig } = require("../../../models");
const DEBUG = process.env.DEBUG === "true";
const GOCARDLESS_API = "https://api-sandbox.gocardless.com";
const API_VERSION = "2015-07-06";

/**
 * Build GoCardless request headers
 * @param {string} accessToken - GoCardless Access Token (fetched from AppConfig)
 */
async function buildHeaders(overrideToken = null) {
  const accessToken = overrideToken || (await getGoCardlessAccessToken());
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

  if (!config?.value)
    throw new Error(
      "No GoCardless merchant account configured for this venue (Franchise + HQ missing)",
    );
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
          .map((e) => `${e.field}: ${e.message}`)
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

/**
 * Create a GoCardless Billing Request (Payment + Mandate + Bank Account)
 */
async function createBillingRequest(payload, overrideToken = null) {
  try {
    if (DEBUG) console.log("🔹 [Payment] Step 1: Preparing request body...");

    const accessToken = overrideToken || (await getGoCardlessAccessToken());

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
      paymentType = "bacs", // ✅ default value
    } = payload;

    if (!customerId) throw new Error("customerId is required");
    if (!amount) throw new Error("amount is required");
    const isInstant = paymentType === "instant_bank_pay";
    const body = {
      billing_requests: {
        payment_request: {
          description,
          amount,
          currency,
          scheme: isInstant ? "faster_payments" : "bacs",
          metadata,
        },
        mandate_request: {
          currency,
          scheme: isInstant ? "faster_payments" : "bacs", // ✅ must match payment_request
          verify: "recommended",
          metadata,
        },
        links: { customer: customerId },
        metadata,
      },
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
      // headers: buildHeaders(accessToken),
      headers: await buildHeaders(accessToken),
      body: JSON.stringify(body),
    });

    const { status, data, message, error } = await handleResponse(response);

    if (!status) {
      return { status: false, message, error };
    }

    if (DEBUG) console.log("✅ Billing request created successfully:", data);

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
async function createMandate({
  customerBankAccountId,
  contract = null,
  scheme = "bacs",
  overrideToken = null,
}) {
  try {
    if (!customerBankAccountId) {
      return {
        status: false,
        message: "Customer Bank Account ID is required.",
      };
    }

    const body = {
      mandates: {
        scheme,
        links: {
          customer_bank_account: customerBankAccountId,
        },
      },
    };

    if (contract) {
      // Flatten contract and convert all values to strings
      const metadata = {};
      for (const [key, value] of Object.entries(contract)) {
        metadata[key] = String(value); // ✅ ensures GoCardless metadata is string
      }
      body.mandates.metadata = metadata;
    }
    if (DEBUG) console.log("🔹 [Mandate] Request body:", body);

    // ✅ Ensure token is fetched if overrideToken is null
    const headers = await buildHeaders(overrideToken);

    const response = await fetch(`${GOCARDLESS_API}/mandates`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const { status, data, message, error } = await handleResponse(response);

    if (!status) {
      if (DEBUG) console.log("❌ Failed to create mandate:", message || error);
      return {
        status: false,
        message: message || "Failed to create mandate.",
        error,
      };
    }

    const mandate = data?.mandates;

    if (!mandate?.id) {
      return {
        status: false,
        message: "Invalid response from GoCardless while creating mandate.",
      };
    }

    if (DEBUG) console.log("✅ Mandate created:", mandate.id);

    return {
      status: true,
      message: "Mandate created successfully.",
      mandate: {
        id: mandate.id,
        reference: mandate.reference,
        status: mandate.status,
        scheme: mandate.scheme,
        customerBankAccount: mandate.links?.customer_bank_account,
        customer: mandate.links?.customer,
        creditor: mandate.links?.creditor,
        metadata: mandate.metadata,
        next_possible_charge_date: mandate.next_possible_charge_date,
      },
    };
  } catch (err) {
    console.error("❌ Error creating mandate:", err);
    return {
      status: false,
      message: "Unexpected error while creating mandate.",
      error: err.message,
    };
  }
}
// create payment
async function createPayment(
  { mandateId, amount, currency = "GBP", description = "" },
  overrideToken = null,
) {
  try {
    if (!mandateId)
      return { status: false, message: "Mandate ID is required." };
    if (!amount || amount <= 0)
      return { status: false, message: "Valid amount is required." };

    // Prepare payload
    const body = {
      payments: {
        amount,
        currency,
        description,
        links: { mandate: mandateId },
      },
    };

    if (DEBUG) console.log("🔹 [Payment] Request body:", body);

    const response = await fetch(`${GOCARDLESS_API}/payments`, {
      method: "POST",
      headers: await buildHeaders(overrideToken),
      body: JSON.stringify(body),
    });

    const { status, data, message, error } = await handleResponse(response);

    if (!status) {
      if (DEBUG) console.log("❌ Payment creation failed:", message || error);
      return {
        status: false,
        message: message || "Failed to create payment.",
        error,
      };
    }

    const payment = data?.payments;

    if (!payment?.id) {
      return {
        status: false,
        message: "Invalid response from GoCardless while creating payment.",
      };
    }

    if (DEBUG) console.log("✅ Payment created:", payment.id);

    // Return only relevant collection-style fields
    return {
      status: true,
      message: "Payment created successfully.",
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        description: payment.description,
        status: payment.status,
        charge_date: payment.charge_date,
        amount_refunded: payment.amount_refunded,
        links: payment.links,
        fx: payment.fx,
        retry_if_possible: payment.retry_if_possible,
        scheme: payment.scheme,
        metadata: payment.metadata,
        created_at: payment.created_at,
      },
    };
  } catch (err) {
    console.error("❌ Error creating payment:", err);

    return {
      status: false,
      message: "Unexpected error while creating payment.",
      error: err.message,
    };
  }
}

async function createSubscription(
  {
    mandateId,
    amount, // mandatory, minor units: GBP → pence
    currency = "GBP",
    interval = 1, // number of interval units
    intervalUnit = "monthly", // "monthly" | "yearly" | custom duration name
    dayOfMonth = 1, // optional, default 1
    count = 1, // total number of payments
    name = "", // subscription name
    retryIfPossible = true,
    metadata = {}, // optional metadata, e.g., { order_no: "ORDER147" }
    startDate = null, // dynamic start date, e.g., "2026-05-01"
  },
  overrideToken = null,
) {
  try {
    if (!mandateId)
      return { status: false, message: "Mandate ID is required." };
    if (!amount || amount <= 0)
      return { status: false, message: "Valid amount is required." };
    // Ensure intervalUnit is valid
    const validIntervalUnits = ["weekly", "monthly", "yearly"];
    let interval_unit = intervalUnit.toLowerCase();
    if (interval_unit === "month") interval_unit = "monthly";
    if (!validIntervalUnits.includes(interval_unit)) {
      throw new Error(`Invalid interval_unit: ${intervalUnit}`);
    }

    // Flatten metadata to strings
    const metadataObj = {};
    for (const [key, value] of Object.entries(metadata)) {
      metadataObj[key] = String(value);
    }
    // Build request payload
    // const body = {
    //   subscriptions: {
    //     amount,
    //     currency,
    //     interval,
    //     interval_unit, // ✅ corrected
    //     day_of_month: dayOfMonth,
    //     count,
    //     name,
    //     retry_if_possible: retryIfPossible,
    //     metadata: metadataObj, // ✅ all values are strings
    //     links: { mandate: mandateId },
    //   },
    // };
    const body = {
      subscriptions: {
        amount,
        currency,
        interval,
        interval_unit,
        count,
        name,
        retry_if_possible: retryIfPossible,
        metadata: metadataObj,
        links: { mandate: mandateId },
      },
    };

    // ✅ Only set day_of_month if startDate NOT provided
    if (!startDate && dayOfMonth) {
      body.subscriptions.day_of_month = dayOfMonth;
    }

    // ✅ If startDate provided → use it
    if (startDate) {
      body.subscriptions.start_date = startDate;
    }

    // Add start_date if provided dynamically
    if (startDate) body.subscriptions.start_date = startDate;

    if (DEBUG) console.log("🔹 [Subscription] Request body:", body);

    const response = await fetch(`${GOCARDLESS_API}/subscriptions`, {
      method: "POST",
      headers: await buildHeaders(overrideToken),
      body: JSON.stringify(body),
    });

    const { status, data, message, error } = await handleResponse(response);

    if (!status) {
      if (DEBUG)
        console.log("❌ Failed to create subscription:", message || error);
      return {
        status: false,
        message: message || "Failed to create subscription.",
        error,
      };
    }

    const subscription = data?.subscriptions;

    if (!subscription?.id) {
      return {
        status: false,
        message:
          "Invalid response from GoCardless while creating subscription.",
      };
    }

    if (DEBUG) console.log("✅ Subscription created:", subscription.id);

    return {
      status: true,
      message: "Subscription created successfully.",
      subscription: {
        id: subscription.id,
        amount: subscription.amount,
        currency: subscription.currency,
        status: subscription.status,
        name: subscription.name,
        start_date: subscription.start_date,
        end_date: subscription.end_date,
        interval: subscription.interval,
        interval_unit: subscription.interval_unit,
        day_of_month: subscription.day_of_month,
        count: subscription.count,
        metadata: subscription.metadata,
        upcoming_payments: subscription.upcoming_payments,
        links: subscription.links,
        retry_if_possible: subscription.retry_if_possible,
        created_at: subscription.created_at,
        payment_reference: subscription.payment_reference,
        app_fee: subscription.app_fee,
      },
    };
  } catch (err) {
    console.error("❌ Error creating subscription:", err);
    return {
      status: false,
      message: "Unexpected error while creating subscription.",
      error: err.message,
    };
  }
}

/**
 * Create GoCardless One-Off Payment URL (redirect)
 * @param {Object} params
 * @param {string} params.customerId - GoCardless Customer ID
 * @param {number} params.amount - Payment amount in GBP (decimal)
 * @param {string} params.currency - Currency, default "GBP"
 * @param {string} params.description - Description of payment
 * @param {string} params.paymentType - "instant_bank_pay" or "bacs"
 * @param {boolean} params.returnToCustomerPage - redirect to customer page after payment
 * @param {string|null} overrideToken - optional GoCardless access token
 * @returns {string} - URL to redirect user for one-off payment
 */
async function createOneOffPaymentGc(
  {
    customerId,
    amount,
    currency = "GBP",
    description = "",
    paymentType = "instant_bank_pay",
    returnToCustomerPage = true,
  },
  overrideToken = null,
) {
  if (!customerId)
    throw new Error("customerId is required for one-off payment");
  if (!amount || amount <= 0)
    throw new Error("Valid amount is required for one-off payment");

  // Convert GBP decimal → pence
  const amountInPence = Math.round(amount * 100);

  // Base sandbox URL
  const BASE_URL =
    "https://manage-sandbox.gocardless.com/one-off-payment/create";

  // Build URL with query parameters
  const params = new URLSearchParams({
    customer_id: customerId,
    payment_type: paymentType,
    amount: amountInPence,
    currency,
    description,
    return_to_customer_page: returnToCustomerPage ? "true" : "false",
  });

  const redirectUrl = `${BASE_URL}?${params.toString()}`;

  if (DEBUG) console.log("🔥 One-Off Payment URL generated:", redirectUrl);

  return redirectUrl;
}

/**
 * Create GoCardless One-Off Payment via API (no redirect)
 * @param {Object} params
 * @param {string} params.customerId - GoCardless Customer ID
 * @param {number} params.amount - Payment amount in GBP (decimal)
 * @param {string} params.currency - Currency, default "GBP"
 * @param {string} params.description - Payment description
 * @param {string|null} overrideToken - optional GoCardless access token
 * @returns {Object} - Created payment info
 */
async function createOneOffPaymentGcViaApi(
  {
    mandateId, // 🔥 IMPORTANT: pass mandateId instead of customerId
    amount,
    currency = "GBP",
    description = "",
  },
  overrideToken = null,
) {
  if (!mandateId) throw new Error("mandateId is required");
  if (!amount || amount <= 0) throw new Error("Valid amount is required");

  const amountInPence = Math.round(amount * 100);

  // ✅ Directly create payment from existing mandate
  const paymentRes = await createPayment(
    {
      mandateId,
      amount: amountInPence,
      currency,
      description,
    },
    overrideToken,
  );

  if (!paymentRes.status) {
    throw new Error(`Payment creation failed: ${paymentRes.message}`);
  }

  return {
    status: true,
    paymentId: paymentRes.payment.id,
    paymentStatus: paymentRes.payment.status,
    gatewayResponse: paymentRes.payment,
  };
}
module.exports = {
  createBillingRequest,
  createPayment,
  createMandate,
  createSubscription,
  createOneOffPaymentGc,
  createOneOffPaymentGcViaApi,
};
