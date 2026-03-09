const fetch = require("node-fetch"); // npm install node-fetch@2
const axios = require("axios");

const { AppConfig } = require("../../../models");

const DEBUG = process.env.DEBUG === "true";

const BASE_URL =
  process.env.APS_BASE_URL || "https://playpen.accesspaysuite.com/api/v3";

// https://api.accesspaysuite.com/api/v3 for production label url

// ================================
// Fetch credentials (cached)
// ================================
let cachedCredentials = null;

async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;

  const clientCodeConfig = await AppConfig.findOne({
    where: { key: "clientCode" },
  });

  const apiKeyConfig = await AppConfig.findOne({
    where: { key: "apiKey" },
  });

  if (!clientCodeConfig?.value) {
    throw new Error("Missing clientCode in AppConfig");
  }

  if (!apiKeyConfig?.value) {
    throw new Error("Missing apiKey in AppConfig");
  }

  cachedCredentials = {
    clientCode: clientCodeConfig.value,
    apiKey: apiKeyConfig.value,
  };

  return cachedCredentials;
}

// ================================
// Build headers
// ================================
async function buildHeaders() {
  const { apiKey } = await getCredentials();

  return {
    "Content-Type": "application/json",
    apiKey: apiKey,
  };
}

// ================================
// Handle API responses safely
// ================================
async function handleResponse(res) {
  let raw;

  try {
    raw = await res.text();
  } catch {
    raw = null;
  }

  let data;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!res.ok) {
    return {
      status: false,
      message:
        data?.Detail ||
        data?.Message ||
        data?.Errors?.[0]?.Message ||
        raw ||
        `APS Error ${res.status}`,
      error: data,
    };
  }

  return {
    status: true,
    data,
  };
}
function sanitizeBankDetails(accountNumber, sortCode) {
  const cleanAccount = String(accountNumber).replace(/\D/g, "");
  const cleanSort = String(sortCode).replace(/\D/g, "");

  if (cleanAccount.length !== 8) {
    throw new Error("Account number must be exactly 8 digits");
  }

  if (cleanSort.length !== 6) {
    throw new Error("Sort code must be exactly 6 digits");
  }

  return {
    accountNumber: cleanAccount,
    sortCode: cleanSort,
  };
}

// ================================
// 1. Create Schedule
// ================================
async function createSchedule(scheduleData) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/schedules`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(scheduleData),
  });

  return handleResponse(res);
}

// ================================
// 2. Get Schedule
// ================================
async function getSchedules() {
  try {
    const { clientCode } = await getCredentials();
    const headers = await buildHeaders();

    const response = await axios.get(
      `${BASE_URL}/client/${clientCode}/schedules`,
      { headers },
    );

    if (DEBUG) {
      console.log("APS Schedules response:", JSON.stringify(response.data));
    }

    return {
      status: true,
      data: response.data,
    };
  } catch (error) {
    console.error(
      "APS getSchedules error:",
      error.response?.data || error.message,
    );

    // Extract a user-friendly message from error.response.data or fallback to error.message
    let errorMessage = "Unknown error occurred";
    if (error.response?.data) {
      // Sometimes API errors might have 'message' field or other details
      if (typeof error.response.data === "string") {
        errorMessage = error.response.data;
      } else if (error.response.data.message) {
        errorMessage = error.response.data.message;
      } else {
        // fallback stringify the whole object if no message field
        errorMessage = JSON.stringify(error.response.data);
      }
    } else if (error.message) {
      errorMessage = error.message;
    }

    return {
      status: false,
      message: errorMessage,
    };
  }
}

// ================================
// 3. Create Contract (query params)
// ================================

async function createAccessPaySuiteCustomer(queryParams) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/customer?${new URLSearchParams(queryParams)}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
  });

  return handleResponse(res);
}

// ================================
// 4. Cancel Contract (query params)
// ================================

async function createContract(customerId, payload) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/customer/${customerId}/contract`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}

async function cancelContract(contractId, queryParams = {}) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/contract/${contractId}/cancel?${new URLSearchParams(queryParams)}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
  });

  return handleResponse(res);
}

// 5. Freeze Contract (temporary pause)
// ================================
async function freezeContract(contractId, freezeData) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/contract/${contractId}/patch/freeze`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(freezeData),
  });

  return handleResponse(res);
}
// ================================
// 6. Reactivate Contract (unfreeze/reactivate membership)
// ================================
async function reactivateContract(contractId, reactivateData) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/contract/${contractId}/reactivate`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(reactivateData),
  });

  return handleResponse(res);
}

// ================================
// 7. ONE OFF PAYMENT (PRO-RATA)
// ================================
async function createOneOffPayment(contractId, paymentData) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/contract/${contractId}/payment`;

  const payload = {
    Amount: paymentData.amount,
    Description: paymentData.description,
    Date: paymentData.date,
    Reference: paymentData.reference,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}

async function createContractPayment(contractId, paymentData) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/contract/${contractId}/payment`;

  const payload = {
    Amount: paymentData.amount,
    Description: paymentData.description,
    Date: paymentData.date,
    Reference: paymentData.reference,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}

async function createCustomerPayment(customerId, paymentData) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/customer/${customerId}/payment`;

  const payload = {
    Amount: paymentData.amount,
    Description: paymentData.description,
    Date: paymentData.date,
    Reference: paymentData.reference,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}


// ================================
// 8. Cancel Direct Debit
// ================================
async function cancelDirectDebit(contractId) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/contract/${contractId}/cancel`;

  const res = await fetch(url, {
    method: "POST",
    headers,
  });
  return handleResponse(res);
}

// ================================
// 9. Archive Contract
// ================================
async function archiveContract(contractId) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/client/${clientCode}/contract/${contractId}/archive`;

  const res = await fetch(url, {
    method: "POST",
    headers,
  });

  return handleResponse(res);
}
// ================================
// Exports
// ================================
module.exports = {
  getSchedules,
  createSchedule,
  createAccessPaySuiteCustomer,
  createContract,
  cancelContract,
  freezeContract,
  reactivateContract,
  createOneOffPayment,
  createCustomerPayment,
  createContractPayment,
  cancelDirectDebit,
  archiveContract,
};


