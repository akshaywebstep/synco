const fetch = require("node-fetch"); // npm install node-fetch@2
const axios = require('axios');

const { AppConfig } = require("../../../models");

const DEBUG = process.env.DEBUG === "true";
const BASE_URL = "https://playpen.accesspaysuite.com"; // change to prod if needed

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
    apiKey: apiKey, // ✅ MUST be apiKey header
  };
}

// ================================
// Handle API responses safely
// ================================
async function handleResponse(res) {
  const rawText = await res.text(); // ✅ read ONCE

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = rawText;
  }

  if (!res.ok) {
    if (DEBUG) {
      console.error("API ERROR:", res.status, data);
    }
    return { status: false, error: data };
  }

  return { status: true, data };
}

// ================================
// 1. Create Schedule
// ================================
async function createSchedule(scheduleData) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const url = `${BASE_URL}/api/v3/client/${clientCode}/schedules`;

  if (DEBUG) console.log("Creating schedule with JSON body:", url, scheduleData);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(scheduleData),
  });

  return handleResponse(res);
}

async function getSchedules() {
  try {
    const { clientCode } = await getCredentials();
    const headers = await buildHeaders();

    const response = await axios.get(
      `${BASE_URL}/api/v3/client/${clientCode}/schedules`,
      { headers }
    );

    if (DEBUG) {
      console.log("APS Schedules response:", JSON.stringify(response.data));
    }

    return {
      status: true,
      data: response.data,
    };
  } catch (error) {
    console.error("APS getSchedules error:", error.response?.data || error.message);

    return {
      status: false,
      error: error.response?.data || error.message,
    };
  }
}

// ================================
// 2. Create Customer (query params)
// ================================
async function createAccessPaySuiteCustomer(queryParams) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const queryString = new URLSearchParams(queryParams).toString();
  const url = `${BASE_URL}/api/v3/client/${clientCode}/customer?${queryString}`;

  if (DEBUG) console.log("Creating customer URL:", url);

  const res = await fetch(url, {
    method: "POST",
    headers,
  });

  return handleResponse(res);
}

function calculateDaysDifference(fromDate, toDate) {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffMs = end - start;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// ================================
// 3. Create Contract (query params)
// ================================
// async function createContract(customerId, queryParams) {
//   const { clientCode } = await getCredentials();
//   const headers = await buildHeaders();

//   const queryString = new URLSearchParams(queryParams).toString();
//   const url = `${BASE_URL}/api/v3/client/${clientCode}/customer/${customerId}/contract?${queryString}`;

//   if (DEBUG) console.log("Creating contract URL:", url);

//   const res = await fetch(url, {
//     method: "POST",
//     headers,
//   });

//   const responseData = await res.json();

//   // ✅ APS validation error handling
//   if (!res.ok && responseData?.Detail) {
//     const detail = responseData.Detail;

//     // Try to extract date from APS message (DD/MM/YYYY)
//     const match = detail.match(/(\d{2}\/\d{2}\/\d{4})/);

//     if (match) {
//       const earliestDateStr = match[1]; // 12/01/2026
//       const [day, month, year] = earliestDateStr.split("/");
//       const earliestDate = new Date(`${year}-${month}-${day}`);

//       const today = new Date();
//       today.setHours(0, 0, 0, 0);

//       const daysAfter = calculateDaysDifference(today, earliestDate);

//       throw new Error(
//         `Start date is too early. Please select a date at least ${daysAfter} day(s) from today (${earliestDateStr}).`
//       );
//     }

//     // Fallback APS message
//     throw new Error(detail);
//   }

//   return {
//     status: true,
//     data: responseData,
//   };
// }
async function createContract(customerId, queryParams) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const queryString = new URLSearchParams(queryParams).toString();
  const url = `${BASE_URL}/api/v3/client/${clientCode}/customer/${customerId}/contract?${queryString}`;

  if (DEBUG) console.log("Creating contract URL:", url);

  const res = await fetch(url, {
    method: "POST",
    headers,
  });

  const responseData = await res.json();

  // Generic APS error handling only
  if (!res.ok) {
    throw new Error(
      responseData?.Detail ||
      responseData?.Message ||
      "Access PaySuite: Contract creation failed"
    );
  }

  return {
    status: true,
    data: responseData,
  };
}

// ================================
// 4. Cancel Contract (query params)
// ================================
async function cancelContract(contractId, queryParams = {}) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const queryString = new URLSearchParams(queryParams).toString();
  const url = `${BASE_URL}/api/v3/client/${clientCode}/contract/${contractId}/cancel?${queryString}`;

  if (DEBUG) console.log("Cancelling contract:", url);

  const res = await fetch(url, {
    method: "POST",
    headers,
  });
  if (DEBUG) console.log("Cancelling contract response:", res);

  return handleResponse(res);
}

// ================================
// Full Flow: Schedule → Customer → Contract
// ================================

// ================================
// Exports
// ================================
module.exports = {
  getSchedules,
  createSchedule,
  createAccessPaySuiteCustomer,
  createContract,
  cancelContract,
};

// {
//   "schedule": {
//     "scheduleName": "Monthly Gym Membership",
//     "frequency": "Monthly",
//     "amount": 50.00,
//     "interval": 1,
//     "startDate": "2026-12-01T00:00:00.000"
//   },
//   "customer": {
//     "email": "akshaywebstep@gmail.com",
//     "title": "Mr",
//     "customerRef": "555555",
//     "firstName": "Akshay",
//     "surname": "Kumar",
//     "line1": "1 Tebbit Mews",
//     "postCode": "GL52 2NF",
//     "accountNumber": "76846396",
//     "bankSortCode": "364589",
//     "accountHolderName": "Mr Akshay Kumar"
//   },
//   "contract": {
//     "scheduleName": "Monthly Gym Membership",
//     "start": "2026-12-01T00:00:00.000",
//     "isGiftAid": false,
//     "terminationType": "Until further notice",
//     "atTheEnd": "Switch to further notice"
//   }
// }
