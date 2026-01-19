const axios = require("axios");
const { AppConfig } = require("../../models");

const DEBUG = process.env.DEBUG === "true";
const CLICK_SEND_URL = "https://rest.clicksend.com/v3/sms/send";

/**
 * Fetch ClickSend credentials from AppConfig
 */
async function getClickSendConfig() {
    const configs = await AppConfig.findAll({
        where: {
            key: ["CLICKSEND_USERNAME", "CLICKSEND_API_KEY"],
        },
    });

    const configMap = {};
    configs.forEach(cfg => {
        configMap[cfg.key] = cfg.value;
    });

    if (!configMap.CLICKSEND_USERNAME || !configMap.CLICKSEND_API_KEY) {
        throw new Error("ClickSend credentials missing in AppConfig");
    }

    return {
        username: configMap.CLICKSEND_USERNAME,
        apiKey: configMap.CLICKSEND_API_KEY,
    };
}

/**
 * Send SMS using ClickSend
 * @param {string} to - Mobile number with country code
 * @param {string} message - SMS text
 */
async function sendSMS(to, message) {
  try {
    const { username, apiKey } = await getClickSendConfig();

    if (DEBUG) {
      console.log("📲 Sending SMS via ClickSend to:", to);
    }

    const response = await axios.post(
      CLICK_SEND_URL,
      {
        messages: [
          {
            source: "nodejs",
            body: message,
            to,
          },
        ],
      },
      {
        auth: {
          username,
          password: apiKey,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    console.error(
      "❌ ClickSend SMS Error:",
      error.response?.data || error.message
    );
    return {
      success: false,
      error: error.response?.data || error.message,
    };
  }
}
// async function sendSMS(to, message) {
//     try {
//         // 🛑 SMS disabled (DEV / TEST MODE)
//         if (process.env.SMS_ENABLED !== "true") {
//             console.log("🧪 SMS MOCK MODE (not sent):", {
//                 to,
//                 message,
//             });

//             return {
//                 success: true,
//                 mock: true,
//                 message: "SMS skipped (SMS_ENABLED=false)",
//             };
//         }

//         const { username, apiKey } = await getClickSendConfig();

//         if (DEBUG) {
//             console.log("📲 Sending SMS via ClickSend to:", to);
//         }

//         const response = await axios.post(
//             CLICK_SEND_URL,
//             {
//                 messages: [
//                     {
//                         source: "nodejs",
//                         body: message,
//                         to,
//                     },
//                 ],
//             },
//             {
//                 auth: {
//                     username,
//                     password: apiKey,
//                 },
//                 headers: {
//                     "Content-Type": "application/json",
//                 },
//             }
//         );

//         // 💰 Log cost (production only)
//         if (DEBUG) {
//             const cost =
//                 response?.data?.data?.messages?.[0]?.message_price || "N/A";
//             console.log("💰 SMS Cost:", cost);
//         }

//         return {
//             success: true,
//             data: response.data,
//         };
//     } catch (error) {
//         console.error(
//             "❌ ClickSend SMS Error:",
//             error.response?.data || error.message
//         );
//         return {
//             success: false,
//             error: error.response?.data || error.message,
//         };
//     }
// }

module.exports = sendSMS;
