const { AppConfig } = require("../../../models"); // ✅ make sure this import is correct
const DEBUG = process.env.DEBUG === "true";
const GOCARDLESS_API = "https://api-sandbox.gocardless.com";
const API_VERSION = "2015-07-06";

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
  const accessToken = overrideToken || await getGoCardlessAccessToken();

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
          metadata: { crm_id: payload.crm_id },
        },
      }),
    });

    const { status, data, message } = await handleResponse(response);
    if (!status) return { status: false, message };

    const customer = data.customers;

    const bankRes = await createCustomerBankAccount({
      customer: customer.id,
      account_holder_name: payload.account_holder_name,
      account_number: payload.account_number,
      branch_code: payload.branch_code,
      overrideToken,
    });

    if (!bankRes.status) {
      await removeCustomer(customer.id, overrideToken);
      return { status: false, message: bankRes.message };
    }

    return {
      status: true,
      customer,
      bankAccount: bankRes.bankAccount,
    };
  } catch (err) {
    return { status: false, message: err.message };
  }
}


/**
 * Create a GoCardless customer bank account
 */

async function createCustomerBankAccount({
  customer,
  account_holder_name,
  account_number,
  branch_code,
  country_code = "GB",
  overrideToken = null,
}) {
  try {
    if (DEBUG) console.log("🔹 [Bank] Step 1: Preparing request...");

    const body = {
      customer_bank_accounts: {
        country_code,
        account_holder_name,
        account_number,
        branch_code,
        links: { customer },
      },
    };

    if (DEBUG) console.log("✅ Request body:", body);

    const response = await fetch(`${GOCARDLESS_API}/customer_bank_accounts`, {
      method: "POST",
      headers: await buildHeaders(overrideToken),
      body: JSON.stringify(body),
    });

    const { status, data, message, error } = await handleResponse(response);
    if (!status) {
      if (DEBUG) console.log("❌ Failed to create bank account:", message);
      return {
        status: false,
        message: message || "Failed to create bank account.",
        error,
      };
    }

    const bankAccount = data.customer_bank_accounts;
    if (DEBUG) console.log("✅ Bank account created:", bankAccount);

    return {
      status: true,
      message: "Bank account created successfully.",
      bankAccount,
    };
  } catch (err) {
    console.error("❌ Error creating bank account:", err.message);
    return {
      status: false,
      message: "An unexpected error occurred while creating the bank account.",
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

async function cancelBankMembership({ creditorId, accountNumber, branchCode, overrideToken = null }) {
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

async function cancelGoCardlessBillingRequest(billingRequestId, overrideToken = null) {
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

module.exports = {
  createCustomer,
  removeCustomer,
  cancelBankMembership,
  cancelGoCardlessBillingRequest,
};
