const DEBUG = process.env.DEBUG === "true";

const {
  createCustomer,
} = require("../../../../utils/payment/pay360/customer");
const { createBillingRequest } = require("../../../../utils/payment/pay360/payment"); // renamed for consistency

// Simple random generator helpers
function randomEmail() {
  return `user${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
}

function randomString(prefix = "VAL") {
  return `${prefix}${Math.floor(Math.random() * 10000)}`;
}

function randomCity() {
  const cities = ["London", "Manchester", "Liverpool", "Birmingham", "Leeds"];
  return cities[Math.floor(Math.random() * cities.length)];
}

function randomStreet() {
  return `${Math.floor(Math.random() * 9999)} Main Street`;
}

// Controller: Create Book a Free Trial
exports.createCustomer = async (req, res) => {
  if (DEBUG) console.log("📥 Received booking request");

  try {
    // Step 1: Prepare payload for customer creation
    const customerPayload = {
      email: randomEmail(),
      given_name: randomString("FN"),
      family_name: randomString("LN"),
      address_line1: randomStreet(),
      // address_line2: randomStreet(),
      city: randomCity(),
      postal_code: `E8 3GX`,
      country_code: "GB",
      // region: "CA",
      // crm_id: randomString("ABCD"),
      account_holder_name: `${randomString("FN")} ${randomString("LN")}`,
      account_number: "55779911",
      branch_code: "200000",
      // bank_code: "026073150",
      // account_type: "checking",
      // iban: "GB60 BARC 2000 0055 7799 11",
    };

    if (DEBUG) console.log("🛠 Generated payload:", customerPayload);

    // Step 2: Create customer + bank account
    const createCustomerRes = await createCustomer(customerPayload);
    if (!createCustomerRes.status) {
      return res.status(500).json({
        success: false,
        message: createCustomerRes.message || "Failed to create customer.",
        error: createCustomerRes.error || null,
      });
    }

    // Step 3: Prepare payload for billing request
    const billingRequestPayload = {
      customerId: createCustomerRes.customer.id,
      description: "Free Trial Booking",
      amount: 100,
      scheme: "faster_payments",
      currency: "GBP",
      reference: `TRIAL-${Date.now()}`,
      mandateReference: `MD-${Date.now()}`,
      metadata: {
        crm_id: customerPayload.crm_id,
      },
      fallbackEnabled: true,
    };

    if (DEBUG) console.log("🛠 Generated billing request payload:", billingRequestPayload);

    // Step 4: Create billing request
    const createBillingRequestRes = await createBillingRequest(billingRequestPayload);
    if (!createBillingRequestRes.status) {
      await removeCustomer(createCustomerRes.customer.id);
      return res.status(500).json({
        success: false,
        message: createBillingRequestRes.message || "Failed to create billing request.",
        error: createBillingRequestRes.error || null,
      });
    }

    // Step 5: Return success response
    return res.status(201).json({
      success: true,
      message: createCustomerRes.message || "Customer, bank account, and billing request created successfully.",
      data: {
        customer: createCustomerRes.customer,
        bankAccount: createCustomerRes.bankAccount,
        billingRequest: createBillingRequestRes.billingRequest,
      },
    });
  } catch (error) {
    console.error("❌ Error in createCustomer controller:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create customer and billing request",
      error: error.message,
    });
  }
};
