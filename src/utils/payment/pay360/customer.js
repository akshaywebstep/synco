const { AppConfig } = require("../../../models"); // ✅ make sure this import is correct
const DEBUG = process.env.DEBUG === "true";
const GOCARDLESS_API = "https://api-sandbox.gocardless.com";
const API_VERSION = "2015-07-06";
const bcrypt = require("bcrypt");
const crypto = require("crypto");
function generateCrmId() {
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `ABCD${random}`;
}

/**
 * Fetch GoCardless Access Token from AppConfig
 */
async function getGoCardlessAccessToken() {
  const config = await AppConfig.findOne({
    where: { key: "GC_HEAD_OFFICE_TOKEN" },
  });
  if (!config || !config.value) {
    throw new Error("Missing GC_HEAD_OFFICE_TOKEN in AppConfig.");
  }
  return config.value;
}

/**
 * Build GoCardless request headers (AppConfig version)
 */
async function buildHeaders(overrideToken = null) {
  const accessToken = overrideToken || (await getGoCardlessAccessToken());

  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("Authorization", `Bearer ${accessToken}`);
  headers.append("GoCardless-Version", API_VERSION);

  return headers;
}
function validateBankDetails({ account_number, branch_code }) {
  if (!account_number || !/^\d{8}$/.test(account_number)) {
    throw new Error("Account number must be exactly 8 digits");
  }

  if (!branch_code || !/^\d{6}$/.test(branch_code)) {
    throw new Error("Branch code must be exactly 6 digits");
  }
}

/**
 * Handle GoCardless API response safely
 */

// async function handleResponse(response) {
//   let rawText = "";
//   let result = null;

//   try {
//     rawText = await response.text();
//     result = rawText ? JSON.parse(rawText) : null;
//   } catch (e) {
//     // non-JSON response
//   }

//   if (!response.ok) {
//     let message = "API request failed";

//     // GoCardless standard error format
//     if (result?.error?.message) {
//       message = result.error.message;
//     } else if (result?.errors?.length) {
//       message = result.errors
//         .map(e => e.message || e.reason || JSON.stringify(e))
//         .join(", ");
//     } else if (typeof rawText === "string" && rawText.trim()) {
//       message = rawText;
//     }

//     console.error("❌ API Error:", {
//       status: response.status,
//       message,
//       raw: result || rawText,
//     });

//     return {
//       status: false,
//       message,
//       error: result || rawText,
//     };
//   }

//   return {
//     status: true,
//     data: result,
//   };
// }
async function handleResponse(response) {
  let rawText = "";
  let result = null;

  try {
    rawText = await response.text();
    result = rawText ? JSON.parse(rawText) : null;
  } catch (e) {
    // non-JSON response
  }

  if (!response.ok) {
    let message = "API request failed";

    // ✅ Handle GoCardless structured errors properly
    if (result?.error?.errors?.length) {
      message = result.error.errors
        .map((err) => {
          const field = err.field ? err.field.replace(/_/g, " ") : "";
          const formattedField = field.charAt(0).toUpperCase() + field.slice(1);
          return field ? `${formattedField} ${err.message}` : err.message;
        })
        .join(", ");
    }

    // fallback to main message
    else if (result?.error?.message) {
      message = result.error.message;
    }

    // fallback generic errors
    else if (result?.errors?.length) {
      message = result.errors
        .map((e) => e.message || e.reason || JSON.stringify(e))
        .join(", ");
    } else if (typeof rawText === "string" && rawText.trim()) {
      message = rawText;
    }

    console.error("❌ API Error:", {
      status: response.status,
      message,
      raw: result || rawText,
    });

    return {
      status: false,
      message,
      error: result || rawText,
    };
  }

  return {
    status: true,
    data: result,
  };
}

/**
 * Create a GoCardless customer
 */

/* ================= CUSTOMER ================= */

async function createCustomer(payload, overrideToken = null) {
  try {
    const crmId = generateCrmId(); // backend random generate

    // Create customer
    const response = await fetch(`${GOCARDLESS_API}/customers`, {
      method: "POST",
      headers: await buildHeaders(overrideToken),
      body: JSON.stringify({
        customers: {
          email: payload.email,
          given_name: payload.given_name,
          family_name: payload.family_name,
          address_line1: payload.address_line1,
          city: payload.city,
          postal_code: payload.postal_code,
          country_code: payload.country_code,
          metadata: { crm_id: crmId },
        },
      }),
    });

    const { status, data, message } = await handleResponse(response);
    if (!status) return { status: false, message };

    const customer = data.customers;

    // Create bank account
    const bankRes = await createBankAccount({
      customer: customer.id,
      account_holder_name: payload.account_holder_name,
      account_number: payload.account_number,
      branch_code: payload.branch_code,
      overrideToken,
    });

    if (!bankRes.status) {
      await removeCustomer(customer.id, overrideToken); // rollback if bank account fails
      return { status: false, message: bankRes.message };
    }

    return {
      status: true,
      message: "Customer and bank account created successfully.",
      customer,
      bankAccount: bankRes.bankAccount,
      customer_bank_accounts: bankRes.bankAccount,
    };
  } catch (err) {
    return { status: false, message: err.message };
  }
}

/* ---------------- Bank Account Helper ---------------- */

async function createBankAccount({
  customer,
  account_holder_name,
  account_number,
  branch_code,
  country_code = "GB",
  overrideToken = null,
}) {
  try {
    if (!customer)
      return { status: false, message: "Customer ID is required." };
    if (!account_holder_name || !account_number || !branch_code)
      return {
        status: false,
        message:
          "Account holder name, account number and branch code are required.",
      };

    const body = {
      customer_bank_accounts: {
        country_code,
        account_holder_name,
        account_number,
        branch_code,
        links: { customer },
      },
    };

    const response = await fetch(`${GOCARDLESS_API}/customer_bank_accounts`, {
      method: "POST",
      headers: await buildHeaders(overrideToken),
      body: JSON.stringify(body),
    });

    const { status, data, message, error } = await handleResponse(response);
    if (!status)
      return {
        status: false,
        message: message || "Failed to create bank account.",
        error,
      };

    const bankAccount = data?.customer_bank_accounts;
    if (!bankAccount?.id)
      return { status: false, message: "Invalid response from GoCardless." };

    return {
      status: true,
      message: "Bank account created successfully.",
      bankAccount: {
        id: bankAccount.id,
        bank_name: bankAccount.bank_name,
        account_number_ending: bankAccount.account_number_ending,
        currency: bankAccount.currency,
        country_code: bankAccount.country_code,
        enabled: bankAccount.enabled,
        customer: bankAccount.links?.customer,
      },
    };
  } catch (err) {
    return {
      status: false,
      message: "Unexpected error creating bank account.",
      error: err.message,
    };
  }
}

/**
 * Remove a GoCardless customer
 */

async function removeCustomer(customerId, overrideToken = null) {
  try {
    if (DEBUG) console.log("🔹 [Remove] Step 1: Preparing headers...");
    const headers = await buildHeaders(overrideToken);

    if (DEBUG) console.log("✅ Headers ready:", headers);

    if (DEBUG) console.log("🔹 [Remove] Step 2: Sending DELETE request...");
    const response = await fetch(`${GOCARDLESS_API}/customers/${customerId}`, {
      method: "DELETE",
      headers,
    });

    if (DEBUG) console.log("✅ Response received. Status:", response.status);

    if (DEBUG) console.log("🔹 [Remove] Step 3: Handling response...");
    const { status, message, error } = await handleResponse(response);

    if (!status) {
      if (DEBUG) console.log("❌ Delete failed with error:", message);
      return {
        status: false,
        message: message || `Failed to delete customer with ID: ${customerId}.`,
        error,
      };
    }

    if (DEBUG) console.log("✅ Customer deleted successfully:", customerId);

    return {
      status: true,
      message: `Customer with ID: ${customerId} deleted successfully.`,
      customerId,
    };
  } catch (err) {
    console.error("❌ Error deleting customer:", err.message);
    return {
      status: false,
      message: `An unexpected error occurred while deleting customer with ID: ${customerId}.`,
      error: err.message,
    };
  }
}

async function cancelBankMembership({
  creditorId,
  accountNumber,
  branchCode,
  overrideToken = null,
}) {
  // Step 1: List creditor bank accounts for the creditor
  const response = await fetch(
    `${GOCARDLESS_API}/creditor_bank_accounts?creditor=${creditorId}`,
    {
      method: "GET",
      headers: await buildHeaders(overrideToken),
    },
  );
  const result = await response.json();

  if (!response.ok) {
    return {
      status: false,
      message: "Failed to fetch creditor bank accounts",
      error: result,
    };
  }

  // Step 2: Find the creditor bank account ID to cancel
  const accountToCancel = result.creditor_bank_accounts.find(
    (acc) =>
      acc.account_number === accountNumber && acc.branch_code === branchCode,
  );

  if (!accountToCancel) {
    return { status: false, message: "Bank account to cancel not found" };
  }

  // Step 3: DELETE the creditor bank account by ID
  const deleteResponse = await fetch(
    `${GOCARDLESS_API}/creditor_bank_accounts/${accountToCancel.id}`,
    {
      method: "DELETE",
      headers: await buildHeaders(overrideToken),
    },
  );

  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text();
    return {
      status: false,
      message: "Failed to delete creditor bank account",
      error: errorText,
    };
  }

  return { status: true, message: "Bank membership cancelled successfully" };
}

async function cancelGoCardlessBillingRequest(
  billingRequestId,
  overrideToken = null,
) {
  try {
    if (!billingRequestId) {
      throw new Error("Missing billing_request ID");
    }

    if (DEBUG) {
      console.log(
        "🏦 Cancelling GoCardless billing request:",
        billingRequestId,
      );
    }

    const response = await fetch(
      `${GOCARDLESS_API}/billing_requests/${billingRequestId}/actions/cancel`,
      {
        method: "POST",
        headers: await buildHeaders(overrideToken),
      },
    );

    const text = await response.text();

    if (!response.ok) {
      console.error("❌ Billing request cancellation failed:", text);
      return { status: false, message: text };
    }

    const result = JSON.parse(text);

    if (DEBUG) {
      console.log("✅ Billing request cancelled successfully:", result);
    }

    return { status: true, data: result };
  } catch (err) {
    console.error("❌ Error cancelling billing request:", err.message);
    return { status: false, message: err.message };
  }
}
async function cancelGoCardlessPayment(paymentId, overrideToken = null) {
  try {
    if (!paymentId) {
      throw new Error("Missing GoCardless payment ID");
    }

    if (DEBUG) {
      console.log("🏦 Cancelling GoCardless payment:", paymentId);
    }

    const response = await fetch(
      `${GOCARDLESS_API}/payments/${paymentId}/actions/cancel`,
      {
        method: "POST",
        headers: await buildHeaders(overrideToken),
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error("❌ Payment cancellation failed:", text);
      return { status: false, message: text };
    }

    const result = JSON.parse(text);

    return { status: true, data: result };
  } catch (err) {
    console.error("❌ Error cancelling payment:", err.message);
    return { status: false, message: err.message };
  }
}
async function refundGoCardlessPayment(paymentId, overrideToken = null) {
  try {
    if (!paymentId) {
      throw new Error("Missing GoCardless payment ID");
    }

    console.log("💸 Refunding GoCardless payment:", paymentId);

    const response = await fetch(
      `${GOCARDLESS_API}/refunds`,
      {
        method: "POST",
        headers: await buildHeaders(overrideToken),
        body: JSON.stringify({
          refunds: {
            payment: paymentId
          }
        })
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error("❌ Refund failed:", text);
      return { status: false, message: text };
    }

    const result = JSON.parse(text);

    console.log("✅ Refund successful:", result);

    return { status: true, data: result };

  } catch (err) {
    console.error("❌ Refund error:", err.message);
    return { status: false, message: err.message };
  }
}

/**
 * Cancel a GoCardless subscription
 * @param {string} subscriptionId
 * @param {string|null} overrideToken
 * @returns {object} { status: boolean, message, data }
 */
async function cancelGoCardlessSubscription(subscriptionId, overrideToken = null) {
  if (!subscriptionId) throw new Error("Missing subscription ID for cancellation");

  try {
    if (DEBUG) console.log("🏦 Cancelling GoCardless subscription:", subscriptionId);

    const response = await fetch(`${GOCARDLESS_API}/subscriptions/${subscriptionId}/actions/cancel`, {
      method: "POST",
      headers: await buildHeaders(overrideToken),
      body: JSON.stringify({ metadata: { reason: "Membership cancelled" } }),
    });

    const result = await handleResponse(response);

    if (!result.status) {
      console.error("❌ Subscription cancellation failed:", result.message);
      return result;
    }

    if (DEBUG) console.log("✅ Subscription cancelled successfully:", result.data);
    return { status: true, message: "Subscription cancelled successfully", data: result.data };
  } catch (err) {
    console.error("❌ Error cancelling subscription:", err.message);
    return { status: false, message: err.message };
  }
}
// Freeze (pause) a GoCardless subscription for a specified duration with reason
async function pauseGoCardlessSubscription({
  subscriptionId,
  freezeDurationMonths,
  reasonForFreezing,
  overrideToken = null
}) {
  try {
    if (!subscriptionId) {
      throw new Error("Missing GoCardless subscription ID");
    }

    const pauseCycles = Number(freezeDurationMonths) || 1;

    if (DEBUG) {
      console.log("⏸ Pausing GoCardless subscription:", {
        subscriptionId,
        pauseCycles,
        reasonForFreezing
      });
    }

    const response = await fetch(
      `${GOCARDLESS_API}/subscriptions/${subscriptionId}/actions/pause`,
      {
        method: "POST",
        headers: await buildHeaders(overrideToken),
        body: JSON.stringify({
          subscriptions: {
            pause_cycles: pauseCycles,
            metadata: {
              reason: reasonForFreezing || "Membership freeze"
            }
          }
        })
      }
    );

    const result = await handleResponse(response);

    if (!result.status) {
      console.error("❌ Subscription pause failed:", result.message);
      return result;
    }

    if (DEBUG) {
      console.log("✅ Subscription paused successfully:", result.data);
    }

    return {
      status: true,
      message: "Subscription paused successfully",
      data: result.data
    };

  } catch (err) {
    console.error("❌ Pause subscription error:", err.message);
    return {
      status: false,
      message: err.message
    };
  }
}

module.exports = {
  createCustomer,
  createBankAccount,
  removeCustomer,
  cancelBankMembership,
  cancelGoCardlessBillingRequest,
  cancelGoCardlessPayment,
  cancelGoCardlessSubscription,
  refundGoCardlessPayment,
  pauseGoCardlessSubscription,
};
