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

// async function getSchedules() {
//   try {
//     const { clientCode } = await getCredentials();
//     const headers = await buildHeaders();

//     const response = await axios.get(
//       `${BASE_URL}/api/v3/client/${clientCode}/schedules`,
//       { headers }
//     );

//     if (DEBUG) {
//       console.log("APS Schedules response:", JSON.stringify(response.data));
//     }

//     return {
//       status: true,
//       data: response.data,
//     };
//   } catch (error) {
//     console.error("APS getSchedules error:", error.response?.data || error.message);

//     return {
//       status: false,
//       error: error.response?.data || error.message,
//     };
//   }
// }

// ================================
// 2. Create Customer (query params)
// ================================
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

// async function createAccessPaySuiteCustomer(queryParams) {
//   const { clientCode } = await getCredentials();
//   const headers = await buildHeaders();

//   const queryString = new URLSearchParams(queryParams).toString();
//   const url = `${BASE_URL}/api/v3/client/${clientCode}/customer?${queryString}`;

//   if (DEBUG) console.log("Creating customer URL:", url);

//   const res = await fetch(url, {
//     method: "POST",
//     headers,
//   });

//   return handleResponse(res);
// }

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

async function createAccessPaySuiteCustomer(queryParams) {
  try {
    const { clientCode } = await getCredentials();
    const headers = await buildHeaders();

    const queryString = new URLSearchParams(queryParams).toString();
    const url = `${BASE_URL}/api/v3/client/${clientCode}/customer?${queryString}`;

    if (DEBUG) console.log("Creating customer URL:", url);

    const res = await fetch(url, {
      method: "POST",
      headers,
    });

    if (!res.ok) {
      // Try to extract error message from response body
      let errorData;
      try {
        errorData = await res.json();
      } catch {
        // If response is not json
        errorData = await res.text();
      }

      let errorMessage = "Gateway error occurred";
      if (errorData) {
        if (typeof errorData === "string") {
          errorMessage = errorData;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else {
          errorMessage = JSON.stringify(errorData);
        }
      }

      return {
        status: false,
        message: errorMessage,
      };
    }

    // If response is ok, handle it normally
    return handleResponse(res);

  } catch (error) {
    // Network or unexpected error
    return {
      status: false,
      message: error.message || "Unexpected error occurred",
    };
  }
}

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

//   // Generic APS error handling only
//   if (!res.ok) {
//     throw new Error(
//       responseData?.Detail ||
//       responseData?.Message ||
//       "Access PaySuite: Contract creation failed"
//     );
//   }

//   return {
//     status: true,
//     data: responseData,
//   };
// }

// ================================
// 4. Cancel Contract (query params)
// ================================

async function createContract(customerId, queryParams) {
  try {
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

    if (!res.ok) {
      // Extract error message from known keys or fallback generic
      const errorMessage =
        responseData?.Detail ||
        responseData?.Message ||
        "Access PaySuite: Contract creation failed";

      return {
        status: false,
        message: errorMessage,
      };
    }

    return {
      status: true,
      data: responseData,
    };
  } catch (error) {
    // Network or unexpected error
    return {
      status: false,
      message: error.message || "Unexpected error occurred",
    };
  }
}

async function cancelContract(contractId, queryParams = {}) {
  const { clientCode } = await getCredentials();
  const headers = await buildHeaders();

  const queryString = new URLSearchParams(queryParams).toString();
  const url = `${BASE_URL}/api/v3/client/${clientCode}/contract/${contractId}/cancel?${queryString}`;
  { headers }
  if (DEBUG) console.log("Cancelling contract:", url);

  const res = await fetch(url, {
    method: "POST",
    headers,
  });
  if (DEBUG) console.log("Cancelling contract response:", res);

  return handleResponse(res);
}

// 5. Freeze Contract (temporary pause)
// ================================
async function freezeContract(contractId, freezeData) {
  try {
    const { clientCode } = await getCredentials();
    const headers = await buildHeaders();

    const url = `${BASE_URL}/api/v3/client/${clientCode}/contract/${contractId}/patch/freeze`;

    if (DEBUG) {
      console.log("🔒 Freezing contract");
      console.log("Contract ID:", contractId);
      console.log("Freeze payload:", JSON.stringify(freezeData));
      console.log("Freeze URL:", url);
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(freezeData),
    });

    const rawText = await res.text();
    let data;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = rawText;
    }

    /* ❌ APS Error Handling */
    if (!res.ok) {
      let errorMessage =
        data?.Detail ||
        data?.Message ||
        "Unable to freeze membership at this time.";

      // 🎯 APS specific error mapping
      if (
        res.status === 400 &&
        (data?.Detail?.includes("No previous version") ||
          data?.ErrorCode === 4)
      ) {
        errorMessage =
          "This membership has not started yet. You can freeze the membership only after the contract becomes active.";
      }

      if (DEBUG) {
        console.error("❌ APS Freeze Error:", res.status, data);
      }

      return {
        status: false,
        message: errorMessage,
      };
    }

    // ✅ Success
    return {
      status: true,
      message: "Membership frozen successfully.",
      data,
    };
  } catch (error) {
    console.error("❌ freezeContract Exception:", error);

    return {
      status: false,
      message:
        error.message ||
        "Unexpected error occurred while freezing membership.",
    };
  }
}
// ================================
// 6. Reactivate Contract (unfreeze/reactivate membership)
// ================================
async function reactivateContract(contractId, reactivateData) {
  try {
    const { clientCode } = await getCredentials();
    const headers = await buildHeaders();

    const url = `${BASE_URL}/api/v3/client/${clientCode}/contract/${contractId}/patch/reactivate`;

    if (DEBUG) {
      console.log("🔓 Reactivating contract");
      console.log("Contract ID:", contractId);
      console.log("Reactivate payload:", JSON.stringify(reactivateData));
      console.log("Reactivate URL:", url);
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(reactivateData),
    });

    const rawText = await res.text();
    let data;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = rawText;
    }

    if (!res.ok) {
      let errorMessage =
        data?.Detail ||
        data?.Message ||
        "Unable to reactivate membership at this time.";

      if (DEBUG) {
        console.error("❌ APS Reactivate Error:", res.status, data);
      }

      return {
        status: false,
        message: errorMessage,
      };
    }

    // ✅ Success
    return {
      status: true,
      message: "Membership reactivated successfully.",
      data,
    };
  } catch (error) {
    console.error("❌ reactivateContract Exception:", error);

    return {
      status: false,
      message:
        error.message ||
        "Unexpected error occurred while reactivating membership.",
    };
  }
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
  freezeContract,
  reactivateContract,
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
