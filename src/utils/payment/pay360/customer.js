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
async function buildHeaders() {
  const accessToken = await getGoCardlessAccessToken();
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
        .map(err => {
          const field = err.field ? err.field.replace(/_/g, " ") : "";
          const formattedField =
            field.charAt(0).toUpperCase() + field.slice(1);
          return field
            ? `${formattedField} ${err.message}`
            : err.message;
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
        .map(e => e.message || e.reason || JSON.stringify(e))
        .join(", ");
    }

    else if (typeof rawText === "string" && rawText.trim()) {
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
async function createCustomer({
  email,
  given_name,
  family_name,
  address_line1,
  address_line2,
  city,
  postal_code,
  country_code,
  region,
  crm_id,
  account_holder_name,
  account_number,
  branch_code,
  bank_code,
  account_type,
  iban,
}) {
  try {
    const payload = {
      account_number,
      branch_code,
      country_code,
      account_holder_name,
      bank_code,
      account_type,
      iban,
    };

    validateBankDetails(payload);

    if (DEBUG) {
      console.log("🔹 [Customer] Step 1: Preparing request...");
      console.log("📤 Customer Body:");
    }

    const body = {
      customers: {
        email,
        given_name,
        family_name,
        address_line1,
        address_line2,
        city,
        postal_code,
        country_code,
        region,
        metadata: { crm_id },
      },
    };

    if (DEBUG) {
      console.log(JSON.stringify(body, null, 2));
    }

    const response = await fetch(`${GOCARDLESS_API}/customers`, {
      method: "POST",
      headers: await buildHeaders(),
      body: JSON.stringify(body),
    });

    const rawText = await response.text();

    if (DEBUG) {
      console.log("📥 Raw GoCardless Response:");
      console.log(rawText);
    }

    const parsed = JSON.parse(rawText);

    if (!response.ok) {
      console.log("❌ FULL GoCardless Error:");
      console.log(JSON.stringify(parsed, null, 2));

      const mainMessage = parsed?.error?.message || "Customer creation failed";

      const detailedErrors =
        parsed?.error?.errors?.map(err =>
          `${err.field} ${err.message}`
        ).join(", ") || "";

      return {
        status: false,
        message: detailedErrors || mainMessage,
        error: parsed,
      };
    }

    const customer = parsed.customers;

    // 👉 BANK ACCOUNT STEP
    const customerBankAccountRes = await createCustomerBankAccount({
      customer: customer.id,
      country_code,
      account_holder_name,
      account_number,
      branch_code,
      bank_code,
      account_type,
      iban,
    });

    if (!customerBankAccountRes.status) {
      await removeCustomer(customer.id);
      return customerBankAccountRes;
    }

    return {
      status: true,
      message: "Customer and bank account created successfully.",
      customer,
      bankAccount: customerBankAccountRes.bankAccount,
    };

  } catch (err) {
    console.log("❌ INTERNAL ERROR:", err);
    return { status: false, message: err.message };
  }
}

// async function createCustomer({
//   email,
//   given_name,
//   family_name,
//   address_line1,
//   address_line2,
//   city,
//   postal_code,
//   country_code,
//   region,
//   crm_id,
//   account_holder_name,
//   account_number,
//   branch_code,
//   bank_code,
//   account_type,
//   iban,
// }) {
//   try {
//     if (DEBUG) console.log("🔹 [Customer] Step 1: Preparing request...");

//     const body = {
//       customers: {
//         email,
//         given_name,
//         family_name,
//         address_line1,
//         address_line2,
//         city,
//         postal_code,
//         country_code,
//         region,
//         metadata: { crm_id },
//       },
//     };

//     if (DEBUG) console.log("✅ Request body:", body);

//     const response = await fetch(`${GOCARDLESS_API}/customers`, {
//       method: "POST",
//       headers: await buildHeaders(),
//       body: JSON.stringify(body),
//     });

//     const { status, data, message, error } = await handleResponse(response);
//     if (!status) {
//       return {
//         status: false,
//         message: message || "Unable to create customer. Please check details and try again.",
//         error,
//       };
//     }

//     const customer = data.customers;

//     if (DEBUG) console.log("✅ Customer created:", customer);

//     // Step 2: Create Bank Account
//     const customerBankAccountRes = await createCustomerBankAccount({
//       customer: customer.id,
//       country_code,
//       account_holder_name,
//       account_number,
//       branch_code,
//       bank_code,
//       account_type,
//       iban,
//     });

//     if (!customerBankAccountRes.status) {
//       if (DEBUG)
//         console.log(
//           "❌ Bank account creation failed. Attempting to remove created customer..."
//         );

//       const removeCustomerRes = await removeCustomer(customer.id);

//       if (!removeCustomerRes.status) {
//         return {
//           status: false,
//           message:
//             "Customer was created, but linking the bank account failed. The system also failed to delete the customer record. Please contact support.",
//           error: customerBankAccountRes.error || "Unknown bank account error",
//         };
//       }

//       return {
//         status: false,
//         message: customerBankAccountRes.message || "Incorrect account details",
//         error: customerBankAccountRes.error || "Unknown bank account error",
//       };
//     }

//     return {
//       status: true,
//       message: "Customer and bank account created successfully.",
//       customer,
//       bankAccount: customerBankAccountRes.bankAccount,
//     };
//   } catch (err) {
//     console.error("❌ Error creating customer:", err.message);
//     return {
//       status: false,
//       message:
//         "An unexpected error occurred while creating the customer. Please try again later.",
//       error: err.message,
//     };
//   }
// }

/**
 * Create a GoCardless customer bank account
 */

async function createCustomerBankAccount({
  customer,
  country_code,
  account_holder_name,
  account_number,
  branch_code,
  bank_code,
  account_type,
  iban,
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
      headers: await buildHeaders(),
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

async function removeCustomer(customerId) {
  try {
    if (DEBUG) console.log("🔹 [Remove] Step 1: Preparing headers...");
    const headers = await buildHeaders();

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

async function cancelBankMembership({ creditorId, accountNumber, branchCode }) {
  // Step 1: List creditor bank accounts for the creditor
  const response = await fetch(`${GOCARDLESS_API}/creditor_bank_accounts?creditor=${creditorId}`, {
    method: 'GET',
    headers: await buildHeaders(),
  });
  const result = await response.json();

  if (!response.ok) {
    return { status: false, message: "Failed to fetch creditor bank accounts", error: result };
  }

  // Step 2: Find the creditor bank account ID to cancel
  const accountToCancel = result.creditor_bank_accounts.find(
    acc => acc.account_number === accountNumber && acc.branch_code === branchCode
  );

  if (!accountToCancel) {
    return { status: false, message: "Bank account to cancel not found" };
  }

  // Step 3: DELETE the creditor bank account by ID
  const deleteResponse = await fetch(`${GOCARDLESS_API}/creditor_bank_accounts/${accountToCancel.id}`, {
    method: 'DELETE',
    headers: await buildHeaders(),
  });

  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text();
    return { status: false, message: "Failed to delete creditor bank account", error: errorText };
  }

  return { status: true, message: "Bank membership cancelled successfully" };
}

async function cancelGoCardlessBillingRequest(billingRequestId) {
  try {
    if (!billingRequestId) {
      throw new Error("Missing billing_request ID");
    }

    if (DEBUG) {
      console.log("🏦 Cancelling GoCardless billing request:", billingRequestId);
    }

    const response = await fetch(
      `${GOCARDLESS_API}/billing_requests/${billingRequestId}/actions/cancel`,
      {
        method: "POST",
        headers: await buildHeaders(),
      }
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

module.exports = { createCustomer, removeCustomer, cancelBankMembership, cancelGoCardlessBillingRequest };
