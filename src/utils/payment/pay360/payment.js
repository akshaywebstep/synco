const DEBUG = process.env.DEBUG === "true";
const GOCARDLESS_API = "https://api-sandbox.gocardless.com";
const API_VERSION = "2015-07-06";

/**
 * Build GoCardless request headers
 */
function buildHeaders() {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    headers.append("Authorization", `Bearer ${process.env.GOCARDLESS_ACCESS_TOKEN}`);
    headers.append("GoCardless-Version", API_VERSION);
    return headers;
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
 * Create a GoCardless Billing Request (Payment + Mandate)
 */
async function createBillingRequest({
    customerId,          // ID of the customer to link
    description,         // Payment description
    amount,              // Payment amount in minor units (e.g., 52814 for £528.14)
    scheme = "faster_payments", // Payment scheme
    currency = "GBP",
    reference,           // Payment reference
    mandateReference,    // Mandate reference
    metadata = {},       // Optional metadata for payment and mandate
    fallbackEnabled = true,
}) {
    try {
        if (DEBUG) console.log("🔹 [Payment] Step 1: Preparing request body...");

        const body = {
            billing_requests: {
                payment_request: {
                    description,
                    amount,
                    scheme,
                    currency,
                    // funds_settlement: "direct",
                    // reference,
                    metadata,
                },
                mandate_request: {
                    currency,
                    scheme: "bacs",
                    verify: "recommended",
                    // reference: mandateReference,
                    metadata,
                },
                // fallback_enabled: fallbackEnabled,
                links: {
                    customer: customerId,
                },
                metadata,
            },
        };

        if (DEBUG) console.log("✅ Request body:", body);

        if (DEBUG) console.log("🔹 [Payment] Step 2: Sending request to GoCardless...");
        const response = await fetch(`${GOCARDLESS_API}/billing_requests`, {
            method: "POST",
            headers: buildHeaders(),
            body: JSON.stringify(body),
        });

        const { status, data, error } = await handleResponse(response);
        if (!status) {
            return {
                status: false,
                message: "Failed to create billing request. Please check details and try again.",
                error,
            };
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
            message: "An unexpected error occurred while creating the billing request.",
            error: err.message,
        };
    }
}

module.exports = { createBillingRequest };
