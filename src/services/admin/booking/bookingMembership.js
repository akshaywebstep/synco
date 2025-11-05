const {
  Booking,
  FreezeBooking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  BookingPayment,
  ClassSchedule,
  Venue,
  PaymentPlan,
  Admin,
  CancelBooking,
  AppConfig,
} = require("../../../models");
const { sequelize } = require("../../../models");

const axios = require("axios");
const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createCustomer,
  removeCustomer,
} = require("../../../utils/payment/pay360/customer");
const {
  createBillingRequest,
} = require("../../../utils/payment/pay360/payment");

const DEBUG = process.env.DEBUG === "true";

function generateBookingId(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function updateBookingStats() {
  const debugData = [];

  try {
    const freezeBookings = await FreezeBooking.findAll();

    if (!freezeBookings || freezeBookings.length === 0) {
      console.log("⚠️ No freeze bookings found.");
      return {
        status: false,
        message: "No freeze bookings found.",
        data: debugData,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // normalize to date-only

    for (const freezeBooking of freezeBookings) {
      const bookingId = freezeBooking.bookingId || freezeBooking.id; // use correct bookingId field
      const freezeStartDate = new Date(freezeBooking.freezeStartDate);
      const reactivateOn = new Date(freezeBooking.reactivateOn);

      const bookingDebug = {
        freezeBookingId: freezeBooking.id,
        bookingId,
        freezeStartDate,
        reactivateOn,
        actions: [],
      };

      console.log(`Booking ID: ${bookingId}`);
      console.log(`  - Freeze Start Date: ${freezeStartDate}`);
      console.log(`  - Reactivate On: ${reactivateOn}`);

      // Freeze booking if freezeStartDate is today or in the past
      if (freezeStartDate <= today) {
        const booking = await Booking.findOne({ where: { id: bookingId } });

        if (booking) {
          await booking.update({ status: "frozen" });
          console.log(`  -> Booking status updated to FROZEN`);
          bookingDebug.actions.push("status updated to frozen");
        } else {
          console.log(`  ⚠️ Booking not found for freezing`);
          bookingDebug.actions.push("booking not found for frozen");
        }
      }

      // Reactivate booking if reactivateOn is today or in the past
      if (reactivateOn <= today) {
        const booking = await Booking.findOne({ where: { id: bookingId } });

        if (booking) {
          await booking.update({ status: "active" });
          console.log(`  -> Booking status updated to ACTIVE`);
          bookingDebug.actions.push("status updated to active");
        } else {
          console.log(`  ⚠️ Booking not found for reactivation`);
          bookingDebug.actions.push("booking not found for active");
        }

        console.log(
          `  -> Deleting FreezeBooking entry ID: ${freezeBooking.id}`
        );
        await freezeBooking.destroy();
        bookingDebug.actions.push("freezeBooking entry deleted");
      }

      debugData.push(bookingDebug);
    }

    console.log("✅ Booking stats update completed.");

    return {
      status: true,
      message: "Booking stats updated successfully.",
      data: debugData,
    };
  } catch (error) {
    console.error("❌ Error updating booking stats:", error);
    return {
      status: false,
      message: "Error updating booking stats.",
      error: error.message,
      data: debugData,
    };
  }
}

exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();
  try {
    const adminId = options?.adminId || null;
    const source = options?.source || null;
    const leadId = options?.leadId || null;

    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted source:", leadId);
    }

    if (source !== "open" && !adminId) {
      throw new Error("Admin ID is required for bookedBy");
    }

    let bookedByAdminId = adminId || null;

    if (data.parents?.length > 0) {
      if (DEBUG)
        console.log("🔍 [DEBUG] Source is 'open'. Processing first parent...");

      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (DEBUG) console.log("🔍 [DEBUG] Extracted parent email:", email);

      if (!email) throw new Error("Parent email is required for open booking");

      // 🔍 Check duplicate email in Admin table
      const existingAdmin = await Admin.findOne({
        where: { email },
        transaction: t,
      });

      if (existingAdmin) {
        throw new Error(
          `Parent with email ${email} already exists as an admin.`
        );
      }

      const plainPassword = "Synco123";
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      if (DEBUG)
        console.log("🔍 [DEBUG] Generated hashed password for parent account");

      const [admin, created] = await Admin.findOrCreate({
        where: { email },
        defaults: {
          firstName: firstParent.parentFirstName || "Parent",
          lastName: firstParent.parentLastName || "",
          phoneNumber: firstParent.parentPhoneNumber || "",
          email,
          password: hashedPassword,
          roleId: 9, // parent role
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        transaction: t,
      });

      if (DEBUG) {
        console.log("🔍 [DEBUG] Admin account lookup completed.");
        console.log("🔍 [DEBUG] Was new admin created?:", created);
        console.log(
          "🔍 [DEBUG] Admin record:",
          admin.toJSON ? admin.toJSON() : admin
        );
      }

      if (!created) {
        if (DEBUG)
          console.log(
            "🔍 [DEBUG] Updating existing admin record with parent details"
          );

        await admin.update(
          {
            firstName: firstParent.parentFirstName,
            lastName: firstParent.parentLastName,
            phoneNumber: firstParent.parentPhoneNumber || "",
          },
          { transaction: t }
        );
      }

      if (source === "open") {
        bookedByAdminId = admin.id;
        if (DEBUG)
          console.log("🔍 [DEBUG] bookedByAdminId set to:", bookedByAdminId);
      }
    }

    // 🔹 Step 1: Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        bookingId: generateBookingId(12),
        leadId,
        totalStudents: data.totalStudents,
        classScheduleId: data.classScheduleId,
        startDate: data.startDate || null,
        serviceType: "weekly class membership",
        // keyInformation: data.keyInformation || null,
        bookingType: data.paymentPlanId ? "paid" : "free",
        paymentPlanId: data.paymentPlanId || null,
        status: data.status || "active",
        bookedBy: source === "open" ? bookedByAdminId : adminId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t }
    );

    // 🔹 Step 2: Create Students
    const studentRecords = [];
    for (const student of data.students || []) {
      const studentMeta = await BookingStudentMeta.create(
        {
          bookingTrialId: booking.id,
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
      studentRecords.push(studentMeta);
    }

    // 🔹 Step 3: Create Parents
    if (data.parents?.length && studentRecords.length) {
      const firstStudent = studentRecords[0];

      for (const parent of data.parents) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        if (!email) throw new Error("Parent email is required.");

        // If no duplicates, create parent
        await BookingParentMeta.create(
          {
            studentId: firstStudent.id,
            parentFirstName: parent.parentFirstName,
            parentLastName: parent.parentLastName,
            parentEmail: email,
            parentPhoneNumber: parent.parentPhoneNumber,
            relationToChild: parent.relationToChild,
            howDidYouHear: parent.howDidYouHear,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );
      }
    }

    // 🔹 Step 4: Emergency Contact
    if (
      data.emergency?.emergencyFirstName &&
      data.emergency?.emergencyPhoneNumber &&
      studentRecords.length
    ) {
      const firstStudent = studentRecords[0];
      await BookingEmergencyMeta.create(
        {
          studentId: firstStudent.id,
          emergencyFirstName: data.emergency.emergencyFirstName,
          emergencyLastName: data.emergency.emergencyLastName,
          emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
          emergencyRelation: data.emergency.emergencyRelation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
    }

    // 🔹 Step 5: Process Payment if booking has a payment plan
    // if (booking.paymentPlanId && data.payment?.paymentType) {
    //   const paymentType = data.payment.paymentType; // "bank" or "card"
    //   console.log("Step 5: Start payment process, paymentType:", paymentType);

    //   let paymentStatusFromGateway = "pending";
    //   const firstStudentId = studentRecords[0]?.id;

    //   try {
    //     // Fetch payment plan & pricing
    //     const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
    //       transaction: t,
    //     });
    //     if (!paymentPlan) throw new Error("Invalid payment plan selected.");
    //     const price = paymentPlan.price || 0;

    //     // Fetch venue & classSchedule info
    //     const venue = await Venue.findByPk(data.venueId, { transaction: t });
    //     const classSchedule = await ClassSchedule.findByPk(
    //       data.classScheduleId,
    //       {
    //         transaction: t,
    //       }
    //     );

    //     const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
    //     let gatewayResponse = null;
    //     const amountInPence = Math.round(price * 100);

    //     let goCardlessCustomer;
    //     let goCardlessBankAccount;
    //     let goCardlessBillingRequest;

    //     if (paymentType === "bank") {
    //       // Step 1: Prepare payload for customer creation
    //       // const customerPayload = {
    //       //   email: data.payment.email || data.parents?.[0]?.parentEmail || "",
    //       //   given_name: data.payment.firstName || "",
    //       //   family_name: data.payment.lastName || "",
    //       //   address_line1: data.payment.addressLine1 || "",
    //       //   address_line2: data.payment.addressLine2 || "",
    //       //   city: data.payment.city || "",
    //       //   postal_code: data.payment.postalCode || "",
    //       //   country_code: data.payment.countryCode || "",
    //       //   region: data.payment.region || "",
    //       //   crm_id: `CUSTID-${Date.now()}-${Math.floor(
    //       //     1000 + Math.random() * 9000
    //       //   )}`,
    //       //   account_holder_name: data.payment.account_holder_name || "",
    //       //   account_number: data.payment.account_number || "",
    //       //   branch_code: data.payment.branch_code || "",
    //       //   bank_code: data.payment.bank_code || "",
    //       //   account_type: data.payment.account_type || "",
    //       //   iban: data.payment.iban || "",
    //       // };

    //       const customerPayload = {
    //         email: data.payment.email || data.parents?.[0]?.parentEmail || "",
    //         given_name: data.payment.firstName || "",
    //         family_name: data.payment.lastName || "",
    //         address_line1: data.payment.addressLine1 || "",
    //         city: data.payment.city || "",
    //         postal_code: data.payment.postalCode || "",
    //         country_code: data.payment.countryCode || "GB", // default to GB
    //         currency: data.payment.currency || "GBP",
    //         account_holder_name: data.payment.account_holder_name || "",
    //         account_number: data.payment.account_number || "",
    //         branch_code: data.payment.branch_code || "",
    //       };

    //       if (DEBUG) console.log("🛠 Generated payload:", customerPayload);

    //       // Step 2: Create customer + bank account
    //       const createCustomerRes = await createCustomer(customerPayload);
    //       if (!createCustomerRes.status) {
    //         throw new Error(
    //           createCustomerRes.message ||
    //           "Failed to create goCardless customer."
    //         );
    //       }

    //       // Step 3: Prepare payload for billing request
    //       const billingRequestPayload = {
    //         customerId: createCustomerRes.customer.id,
    //         description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
    //           }`,
    //         amount: price,
    //         scheme: "faster_payments",
    //         currency: "GBP",
    //         reference: `TRX-${Date.now()}-${Math.floor(
    //           1000 + Math.random() * 9000
    //         )}`,
    //         mandateReference: `MD-${Date.now()}-${Math.floor(
    //           1000 + Math.random() * 9000
    //         )}`,
    //         metadata: {
    //           crm_id: customerPayload.crm_id,
    //         },
    //         fallbackEnabled: true,
    //       };

    //       if (DEBUG)
    //         console.log(
    //           "🛠 Generated billing request payload:",
    //           billingRequestPayload
    //         );

    //       // Step 4: Create billing request
    //       const createBillingRequestRes = await createBillingRequest(
    //         billingRequestPayload
    //       );
    //       if (!createBillingRequestRes.status) {
    //         await removeCustomer(createCustomerRes.customer.id);
    //         throw new Error(
    //           createBillingRequestRes.message ||
    //           "Failed to create billing request."
    //         );
    //       }

    //       goCardlessCustomer = createCustomerRes.customer;
    //       goCardlessBankAccount = createCustomerRes.bankAccount;
    //       goCardlessBillingRequest = createBillingRequestRes.billingRequest;
    //     } else if (paymentType === "card") {
    //       // 🔹 Card payment using Pay360
    //       if (
    //         !process.env.PAY360_INST_ID ||
    //         !process.env.PAY360_API_USERNAME ||
    //         !process.env.PAY360_API_PASSWORD
    //       )
    //         throw new Error("Pay360 credentials not set.");

    //       const paymentPayload = {
    //         transaction: {
    //           currency: "GBP",
    //           amount: price,
    //           merchantRef,
    //           description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
    //             }`,
    //           commerceType: "ECOM",
    //         },
    //         paymentMethod: {
    //           card: {
    //             pan: data.payment.pan,
    //             expiryDate: data.payment.expiryDate,
    //             cardHolderName: data.payment.cardHolderName,
    //             cv2: data.payment.cv2,
    //           },
    //         },
    //       };

    //       const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${process.env.PAY360_INST_ID}/payment`;
    //       const authHeader = Buffer.from(
    //         `${process.env.PAY360_API_USERNAME}:${process.env.PAY360_API_PASSWORD}`
    //       ).toString("base64");

    //       const response = await axios.post(url, paymentPayload, {
    //         headers: {
    //           "Content-Type": "application/json",
    //           Authorization: `Basic ${authHeader}`,
    //         },
    //       });

    //       gatewayResponse = response.data;
    //       // Map status dynamically
    //       const txnStatus = gatewayResponse?.transaction?.status?.toLowerCase();
    //       if (txnStatus === "success") {
    //         paymentStatusFromGateway = "paid";
    //       } else if (txnStatus === "pending") {
    //         paymentStatusFromGateway = "pending";
    //       } else if (txnStatus === "declined") {
    //         paymentStatusFromGateway = "failed";
    //       } else {
    //         paymentStatusFromGateway = txnStatus || "unknown";
    //       }
    //     }

    //     // 🔹 Save BookingPayment (always save, even if failed)
    //     await BookingPayment.create(
    //       {
    //         bookingId: booking.id,
    //         paymentPlanId: booking.paymentPlanId,
    //         studentId: firstStudentId,
    //         paymentType,
    //         firstName:
    //           data.payment.firstName ||
    //           data.parents?.[0]?.parentFirstName ||
    //           "",
    //         lastName:
    //           data.payment.lastName || data.parents?.[0]?.parentLastName || "",
    //         email: data.payment.email || data.parents?.[0]?.parentEmail || "",
    //         billingAddress: data.payment.billingAddress || "",
    //         cardHolderName: data.payment.cardHolderName || "",
    //         cv2: data.payment.cv2 || "",
    //         expiryDate: data.payment.expiryDate || "",
    //         pan: data.payment.pan || "",
    //         // referenceId: data.payment.referenceId || "",
    //         account_holder_name: data.payment.account_holder_name || "",
    //         paymentStatus: paymentStatusFromGateway,
    //         currency:
    //           gatewayResponse?.transaction?.currency ||
    //           gatewayResponse?.billing_requests?.currency ||
    //           "GBP",
    //         merchantRef:
    //           gatewayResponse?.transaction?.merchantRef || merchantRef,
    //         description:
    //           gatewayResponse?.transaction?.description ||
    //           `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
    //           }`,
    //         commerceType: "ECOM",
    //         gatewayResponse,
    //         transactionMeta: {
    //           status:
    //             gatewayResponse?.transaction?.status ||
    //             gatewayResponse?.billing_requests?.status ||
    //             "pending",
    //         },
    //         goCardlessCustomer,
    //         goCardlessBankAccount,
    //         goCardlessBillingRequest,
    //         createdAt: new Date(),
    //         updatedAt: new Date(),
    //       },
    //       { transaction: t }
    //     );

    //     console.log(
    //       `${paymentType.toUpperCase()} payment saved with status:`,
    //       paymentStatusFromGateway
    //     );

    //     // 🔹 Fail booking creation only if payment explicitly failed
    //     if (paymentStatusFromGateway === "failed") {
    //       throw new Error("Payment failed. Booking not created.");
    //     }
    //   } catch (err) {
    //     // 🔹 Proper error handling: only show readable message
    //     let errorMessage = "Payment failed";

    //     if (err.response?.data) {
    //       // Gateway returned an error
    //       if (typeof err.response.data === "string") {
    //         errorMessage = err.response.data;
    //       } else if (err.response.data.reasonMessage) {
    //         // Use reasonMessage from gateway response if available
    //         errorMessage = err.response.data.reasonMessage;
    //       } else if (err.response.data.error?.message) {
    //         // Use error.message if available
    //         errorMessage = err.response.data.error.message;
    //       } else {
    //         // Fallback: convert object to string safely
    //         errorMessage = Object.values(err.response.data).join(" | ");
    //       }
    //     } else if (err.message) {
    //       // Standard JS error
    //       errorMessage = err.message;
    //     }

    //     // Rollback transaction
    //     await t.rollback();

    //     // Return clean error message
    //     return {
    //       status: false,
    //       message: errorMessage,
    //     };
    //   }
    // }
    // Step 5: Process Payment if booking has a payment plan
    if (booking.paymentPlanId && data.payment?.paymentType) {
      const paymentType = data.payment.paymentType; // "bank" or "card"
      console.log("Step 5: Start payment process, paymentType:", paymentType);

      console.log(`Step - 1`);
      let paymentStatusFromGateway = "pending";
      const firstStudentId = studentRecords[0]?.id;
      console.log(`Step - 2`);

      try {
        // ✅ Fetch Payment Plan to get price
        const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
          transaction: t,
        });
        if (!paymentPlan) throw new Error("Invalid payment plan selected.");
        const planPrice = paymentPlan.price || 0;
        console.log(`Step - 3`);

        // Fetch venue & classSchedule info
        const venue = await Venue.findByPk(data.venueId, { transaction: t });
        const classSchedule = await ClassSchedule.findByPk(
          data.classScheduleId,
          { transaction: t }
        );

        const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
        let gatewayResponse = null;
        let response;
        let goCardlessCustomer, goCardlessBankAccount, goCardlessBillingRequest;
        console.log(`Step - 4`);

        if (paymentType === "bank") {
          // ✅ Prepare GoCardless payload
          const customerPayload = {
            email: data.payment.email || data.parents?.[0]?.parentEmail || "",
            given_name: data.payment.firstName || "",
            family_name: data.payment.lastName || "",
            address_line1: data.payment.addressLine1 || "",
            city: data.payment.city || "",
            postal_code: data.payment.postalCode || "",
            country_code: data.payment.countryCode || "GB",
            currency: data.payment.currency || "GBP",
            account_holder_name: data.payment.account_holder_name || "",
            account_number: data.payment.account_number || "",
            branch_code: data.payment.branch_code || "",
          };

          const createCustomerRes = await createCustomer(customerPayload);
          if (!createCustomerRes.status)
            throw new Error(
              createCustomerRes.message ||
              "Failed to create GoCardless customer."
            );

          const billingRequestPayload = {
            customerId: createCustomerRes.customer.id,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            amount: planPrice, // ✅ use plan price
            scheme: "faster_payments",
            currency: "GBP",
            reference: `TRX-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000
            )}`,
            mandateReference: `MD-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000
            )}`,
            metadata: { crm_id: customerPayload.crm_id },
            fallbackEnabled: true,
          };

          const createBillingRequestRes = await createBillingRequest(
            billingRequestPayload
          );
          if (!createBillingRequestRes.status) {
            await removeCustomer(createCustomerRes.customer.id);
            throw new Error(
              createBillingRequestRes.message ||
              "Failed to create billing request."
            );
          }

          goCardlessCustomer = createCustomerRes.customer;
          goCardlessBankAccount = createCustomerRes.bankAccount;
          goCardlessBillingRequest = {
            ...createBillingRequestRes.billingRequest,
            planPrice,
          }; // ✅ store plan price
        } else if (paymentType === "card") {
          console.log(`Step - 5`);

          // Card payment
          const paymentPayload = {
            transaction: {
              currency: "GBP",
              amount: planPrice, // ✅ use plan price
              merchantRef,
              description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
                }`,
              commerceType: "ECOM",
            },
            paymentMethod: {
              card: {
                pan: data.payment.pan,
                expiryDate: data.payment.expiryDate,
                cardHolderName: data.payment.cardHolderName,
                cv2: data.payment.cv2,
              },
            },
          };

          // ✅ Fetch Pay360 credentials dynamically from AppConfig
          const [instIdConfig, usernameConfig, passwordConfig] = await Promise.all([
            AppConfig.findOne({ where: { key: "PAY360_INST_ID" }, transaction: t }),
            AppConfig.findOne({ where: { key: "PAY360_API_USERNAME" }, transaction: t }),
            AppConfig.findOne({ where: { key: "PAY360_API_PASSWORD" }, transaction: t }),
          ]);

          if (!instIdConfig || !usernameConfig || !passwordConfig) {
            throw new Error("Missing Pay360 configuration in AppConfig table.");
          }

          const PAY360_INST_ID = instIdConfig.value;
          const PAY360_API_USERNAME = usernameConfig.value;
          const PAY360_API_PASSWORD = passwordConfig.value;

          // ✅ Construct Pay360 API URL dynamically
          const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${PAY360_INST_ID}/payment`;

          try {
            // ✅ Build Basic Auth header using DB values
            const authHeader = Buffer.from(
              `${PAY360_API_USERNAME}:${PAY360_API_PASSWORD}`
            ).toString("base64");

            response = await axios.post(url, paymentPayload, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${authHeader}`,
              },
            });
            // Log the full response if needed
            console.log("🔍 [DEBUG] Full Axios response:", response);
          } catch (err) {
            console.error(
              "❌ Axios request failed:",
              err.response?.data || err.message || err
            );
          }

          const gatewayResponse = response?.data;

          // Safely check if transaction and status exist
          const txnStatus = gatewayResponse?.transaction?.status
            ? gatewayResponse.transaction.status.toLowerCase()
            : null;

          paymentStatusFromGateway =
            txnStatus === "success"
              ? "paid"
              : txnStatus === "pending"
                ? "pending"
                : txnStatus === "declined"
                  ? "failed"
                  : txnStatus || "unknown";
        }

        console.log("🔍 [DEBUG] Response data:", response?.data);

        // 🔹 Save BookingPayment
        await BookingPayment.create(
          {
            bookingId: booking.id,
            paymentPlanId: booking.paymentPlanId,
            studentId: firstStudentId,
            paymentType,
            firstName:
              data.payment.firstName ||
              data.parents?.[0]?.parentFirstName ||
              "",
            lastName:
              data.payment.lastName || data.parents?.[0]?.parentLastName || "",
            email: data.payment.email || data.parents?.[0]?.parentEmail || "",
            amount: planPrice, // ✅ save price from PaymentPlan
            billingAddress: data.payment.billingAddress || "",
            cardHolderName: data.payment.cardHolderName || "",
            cv2: data.payment.cv2 || "",
            expiryDate: data.payment.expiryDate || "",
            pan: data.payment.pan || "",
            account_holder_name: data.payment.account_holder_name || "",
            paymentStatus: paymentStatusFromGateway,
            currency: gatewayResponse?.transaction?.currency || "GBP",
            merchantRef:
              gatewayResponse?.transaction?.merchantRef || merchantRef,
            description:
              gatewayResponse?.transaction?.description ||
              `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            commerceType: "ECOM",
            gatewayResponse,
            transactionMeta: {
              status: gatewayResponse?.transaction?.status || "pending",
            },
            goCardlessCustomer,
            goCardlessBankAccount,
            goCardlessBillingRequest,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );

        if (paymentStatusFromGateway === "failed")
          throw new Error("Payment failed. Booking not created.");
        if (DEBUG) {
          console.log(
            "🔍 [DEBUG] Extracted paymentStatusFromGateway:",
            paymentStatusFromGateway
          );
        }
      } catch (err) {
        await t.rollback();
        return { status: false, message: err.message || "Payment failed" };
        if (DEBUG) {
          console.log("🔍 [DEBUG] Extracted message:", message);
        }
      }
    }

    // 🔹 Step 6: Update Class Capacity
    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
      transaction: t,
    });
    const newCapacity = classSchedule.capacity - data.totalStudents;
    if (newCapacity < 0) throw new Error("Not enough capacity left.");
    await classSchedule.update({ capacity: newCapacity }, { transaction: t });

    await t.commit();
    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentRecords[0]?.id,
        studentFirstName: studentRecords[0]?.studentFirstName,
        studentLastName: studentRecords[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

exports.getAllBookingsWithStats = async (filters = {}) => {
  await updateBookingStats();

  try {
    // const whereBooking = { bookingType: "paid" };
    const whereBooking = {
      bookingType: {
        [Op.in]: ["paid", "waiting list", "removed"],
      },
      status: {
        [Op.in]: [
          "cancelled",
          "active",
          "frozen",
          "waiting list",
          "request_to_cancel",
          "rebooked",
          "removed",
          "attended",
          "not attended",
        ], // only these statuses
      },
    };
    const whereVenue = {};

    console.log(`filters - `, filters);
    // 🔹 Filters
    // if (filters.status) whereBooking.status = filters.status;
    if (filters.status) {
      whereBooking.status = Array.isArray(filters.status)
        ? { [Op.in]: filters.status }
        : filters.status;
    }

    if (filters.venueId) whereBooking.venueId = filters.venueId;
    if (filters.venueName)
      whereVenue.name = { [Op.like]: `%${filters.venueName}%` };
    if (filters.bookedBy) {
      // Ensure bookedBy is always an array
      const bookedByArray = Array.isArray(filters.bookedBy)
        ? filters.bookedBy
        : [filters.bookedBy];

      whereBooking.bookedBy = { [Op.in]: bookedByArray };
    }
    if (filters.duration) {
      const keyword = `%${filters.duration}%`;

      whereBooking[Op.or] = [
        { "$paymentPlan.duration$": { [Op.like]: keyword } },
        { "$paymentPlan.interval$": { [Op.like]: keyword } },
      ];
    }

    // ✅ Date filters
    if (filters.dateBooked) {
      const start = new Date(`${filters.dateBooked} 00:00:00`);
      const end = new Date(`${filters.dateBooked} 23:59:59`);
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom && filters.dateTo) {
      const start = new Date(`${filters.dateFrom} 00:00:00`);
      const end = new Date(`${filters.dateTo} 23:59:59`);
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom) {
      const start = new Date(`${filters.dateFrom} 00:00:00`);
      whereBooking.createdAt = { [Op.gte]: start };
    } else if (filters.dateTo) {
      const end = new Date(`${filters.dateTo} 23:59:59`);
      whereBooking.createdAt = { [Op.lte]: end };
    }

    const bookings = await Booking.findAll({
      where: {
        ...whereBooking, // spread the filters correctly
        // serviceType: "weekly class membership",
        serviceType: {
          [Op.in]: ["weekly class membership", "weekly class trial"], // ✅ both types
        },
      },
      order: [["id", "DESC"]],
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          include: [
            {
              model: Venue,
              as: "venue",
              where: whereVenue,
              required: !!filters.venueName,
            },
          ],
        },
        { model: BookingPayment, as: "payments", required: false },
        { model: PaymentPlan, as: "paymentPlan", required: false },
        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
            "profile",
          ],
          required: false,
        },
      ],
    });

    const parsedBookings = await Promise.all(
      bookings.map(async (booking) => {
        // Students
        const students =
          booking.students?.map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          })) || [];

        // Parents (flatten all student parents)
        const parents =
          booking.students?.flatMap(
            (s) =>
              s.parents?.map((p) => ({
                parentFirstName: p.parentFirstName,
                parentLastName: p.parentLastName,
                parentEmail: p.parentEmail,
                parentPhoneNumber: p.parentPhoneNumber,
                relationToChild: p.relationToChild,
                howDidYouHear: p.howDidYouHear,
              })) || []
          ) || [];

        // Emergency contacts (take first one per student)
        // ✅ Pick only the first student's emergency contacts
        const emergency =
          booking.students?.[0]?.emergencyContacts?.map((e) => ({
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || [];

        // Venue & plan
        const venue = booking.classSchedule?.venue || null;
        const plan = booking.paymentPlan || null;

        const payment = booking.payments?.[0] || null;
        const paymentPlans = plan ? [plan] : [];

        // PaymentData with parsed gatewayResponse & transactionMeta
        let parsedGatewayResponse = {};
        let parsedTransactionMeta = {};

        try {
          if (payment?.gatewayResponse) {
            parsedGatewayResponse =
              typeof payment.gatewayResponse === "string"
                ? JSON.parse(payment.gatewayResponse)
                : payment.gatewayResponse;
          }
        } catch (e) {
          console.error("Invalid gatewayResponse JSON", e);
        }

        try {
          if (payment?.transactionMeta) {
            parsedTransactionMeta =
              typeof payment.transactionMeta === "string"
                ? JSON.parse(payment.transactionMeta)
                : payment.transactionMeta;
          }
        } catch (e) {
          console.error("Invalid transactionMeta JSON", e);
        }

        const paymentData = payment
          ? {
            id: payment.id,
            bookingId: payment.bookingId,
            firstName: payment.firstName,
            lastName: payment.lastName,
            email: payment.email,
            billingAddress: payment.billingAddress,
            cardHolderName: payment.cardHolderName,
            cv2: payment.cv2,
            expiryDate: payment.expiryDate,
            paymentType: payment.paymentType,
            pan: payment.pan,
            paymentStatus: payment.paymentStatus,
            referenceId: payment.referenceId,
            currency: payment.currency,
            merchantRef: payment.merchantRef,
            description: payment.description,
            commerceType: payment.commerceType,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
            gatewayResponse: parsedGatewayResponse,
            transactionMeta: parsedTransactionMeta,
            totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
          }
          : null;

        const { venue: _venue, ...bookingData } = booking.dataValues;

        return {
          ...bookingData,
          students,
          parents,
          emergency,
          classSchedule: booking.classSchedule || null,
          // payments: booking.payments || [],
          paymentPlan: booking.paymentPlan || null,
          paymentPlans,
          venue,
          paymentData,
          bookedByAdmin: booking.bookedByAdmin || null,
        };
      })
    );

    // Student filter
    let finalBookings = parsedBookings;
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase().trim();
      finalBookings = finalBookings
        .map((b) => {
          const matchedStudents = b.students.filter((s) => {
            const firstName = s.studentFirstName?.toLowerCase() || "";
            const lastName = s.studentLastName?.toLowerCase() || "";
            const fullName = `${firstName} ${lastName}`.trim();

            return (
              firstName.includes(keyword) ||
              lastName.includes(keyword) ||
              fullName.includes(keyword)
            );
          });

          if (matchedStudents.length > 0) {
            return {
              ...b,
              students: matchedStudents,
            };
          }
          return null;
        })
        .filter(Boolean);

      if (finalBookings.length === 0) {
        return {
          status: true,
          message: "No bookings found for the student.",
          totalPaidBookings: 0,
          data: { membership: [], venue: [], bookedByAdmins: [] },
          stats: {
            totalStudents: 0,
            totalRevenue: 0,
            avgMonthlyFee: 0,
            avgLifeCycle: 0,
          },
        };
      }
    }

    // Venue filter
    if (filters.venueName) {
      const keyword = filters.venueName.toLowerCase();
      finalBookings = finalBookings.filter((b) =>
        b.venue?.name?.toLowerCase().includes(keyword)
      );
      if (finalBookings.length === 0) {
        return {
          status: true,
          message: "No bookings found for the venue.",
          totalPaidBookings: 0,
          data: { membership: [], venue: [], bookedByAdmins: [] },
          stats: {
            totalStudents: 0,
            totalRevenue: 0,
            avgMonthlyFee: 0,
            avgLifeCycle: 0,
          },
        };
      }
    }

    // Collect unique venues
    const venueMap = {};
    bookings.forEach((b) => {
      if (b.classSchedule?.venue) {
        venueMap[b.classSchedule.venue.id] = b.classSchedule.venue;
      }
    });
    const allVenues = Object.values(venueMap);

    // Collect unique bookedByAdmins
    const adminMap = {};
    bookings.forEach((b) => {
      if (b.bookedByAdmin) {
        adminMap[b.bookedByAdmin.id] = b.bookedByAdmin;
      }
    });
    const allAdmins = Object.values(adminMap);

    // Stats
    const totalStudents = finalBookings.reduce(
      (acc, b) => acc + (b.students?.length || 0),
      0
    );

    // ✅ Calculate revenue only from PaymentPlan (price + joiningFee) * student count
    const totalRevenue = finalBookings.reduce((acc, b) => {
      const plan = b.paymentPlans?.[0];
      if (plan?.price != null) {
        const studentsCount = b.students?.length || 1;
        return acc + (plan.price + (plan.joiningFee || 0)) * studentsCount;
      }
      return acc;
    }, 0);

    // ✅ Average monthly fee (spread over duration)
    const avgMonthlyFeeRaw =
      finalBookings.reduce((acc, b) => {
        const plan = b.paymentPlans?.[0];
        if (plan?.duration && plan.price != null) {
          const studentsCount = b.students?.length || 1;
          return (
            acc +
            ((plan.price + (plan.joiningFee || 0)) / plan.duration) *
            studentsCount
          );
        }
        return acc;
      }, 0) / (totalStudents || 1);

    // Round to 2 decimals (returns Number)
    const avgMonthlyFee = Math.round(avgMonthlyFeeRaw * 100) / 100;

    // ✅ Average lifecycle (duration * student count)
    const avgLifeCycle =
      finalBookings.reduce((acc, b) => {
        const plan = b.paymentPlans?.[0];
        if (plan?.duration != null) {
          const studentsCount = b.students?.length || 1;
          return acc + plan.duration * studentsCount;
        }
        return acc;
      }, 0) / (totalStudents || 1);
    // ✅ New: Fetch all venues from DB (including those with no bookings)
    const allVenuesFromDB = await Venue.findAll({
      order: [["name", "ASC"]],
      include: [
        {
          model: ClassSchedule,
          as: "classSchedules", // <-- make sure this matches your Sequelize association alias
          required: false, // include venues even if they have no classes
        },
      ],
    });

    return {
      status: true,
      message: "Paid bookings retrieved successfully",
      totalPaidBookings: finalBookings.length,
      data: {
        membership: finalBookings,
        venue: allVenues,
        bookedByAdmins: allAdmins, // ✅ unique list of admins like venues
        allVenues: allVenuesFromDB,
      },
      stats: { totalStudents, totalRevenue, avgMonthlyFee, avgLifeCycle },
    };
  } catch (error) {
    console.error("❌ getAllBookingsWithStats Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getActiveMembershipBookings = async (filters = {}) => {
  await updateBookingStats();

  try {
    console.log("🔹 Service start: getActiveMembershipBookings");
    console.log("🔹 Filters received in service:", filters);

    // ✅ Default filter: active + paid bookings
    const whereBooking = { bookingType: "paid", status: "active" };
    const whereVenue = {};

    // 🔹 Apply filters
    if (filters.venueId) whereBooking.venueId = filters.venueId;
    if (filters.venueName) {
      whereVenue.name = { [Op.like]: `%${filters.venueName}%` };
    }

    /*
    if (filters.bookedBy) {
      whereBooking[Op.or] = [
        { "$admin.firstName$": { [Op.like]: `%${filters.bookedBy}%` } },
        { "$admin.lastName$": { [Op.like]: `%${filters.bookedBy}%` } },
      ];
    }
    */

    if (filters.bookedBy) {
      // Ensure bookedBy is always an array
      const bookedByArray = Array.isArray(filters.bookedBy)
        ? filters.bookedBy
        : [filters.bookedBy];

      whereBooking.bookedBy = { [Op.in]: bookedByArray };
    }
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    }
    if (filters.planType) {
      whereBooking["$paymentPlan.duration$"] = {
        [Op.like]: `%${filters.planType}%`,
      };
    }
   
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase().trim();

      // ✅ Handles first name, last name, or full name (e.g., "akshay kumar")
      whereBooking[Op.or] = [
        { "$students.studentFirstName$": { [Op.like]: `%${keyword}%` } },
        { "$students.studentLastName$": { [Op.like]: `%${keyword}%` } },
        {
          [Op.and]: [
            {
              "$students.studentFirstName$": {
                [Op.ne]: null,
              },
            },
            {
              "$students.studentLastName$": {
                [Op.ne]: null,
              },
            },
            Sequelize.where(
              Sequelize.fn(
                "LOWER",
                Sequelize.fn(
                  "CONCAT",
                  Sequelize.col("students.studentFirstName"),
                  " ",
                  Sequelize.col("students.studentLastName")
                )
              ),
              {
                [Op.like]: `%${keyword}%`,
              }
            ),
          ],
        },
      ];
    }

    // ✅ Date filters
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom && filters.dateTo) {
      const start = new Date(filters.dateFrom + " 00:00:00");
      const end = new Date(filters.dateTo + " 23:59:59");
      whereBooking.startDate = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      whereBooking.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.lte]: end };
    }

    console.log("🔹 whereBooking:", whereBooking);

    // 🔹 Fetch bookings
    const bookings = await Booking.findAll({
      where: {
        ...whereBooking, // spread the filters correctly
        serviceType: "weekly class membership",
      },
      // where: whereBooking,
      order: [["id", "DESC"]],
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: true,
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: true,
          include: [
            { model: Venue, as: "venue", where: whereVenue, required: true },
          ],
        },
        { model: BookingPayment, as: "payments", required: false },
        { model: PaymentPlan, as: "paymentPlan", required: false },
        { model: Admin, as: "admin", required: false },
      ],
    });

    console.log("🔹 Bookings fetched:", bookings.length);

    // 🔹 Map bookings to memberShipSales
    const memberShipSales = bookings.map((booking) => {
      const venue = booking.classSchedule?.venue || {};
      const payment = booking.payments?.[0] || {};
      const plan = booking.paymentPlan || null;

      // Students
      const students =
        booking.students?.map((student) => ({
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
        })) || [];

      // Parents
      const parents =
        booking.students?.flatMap(
          (student) =>
            student.parents?.map((parent) => ({
              parentFirstName: parent.parentFirstName,
              parentLastName: parent.parentLastName,
              parentEmail: parent.parentEmail,
              parentPhoneNumber: parent.parentPhoneNumber,
              relationToChild: parent.relationToChild,
              howDidYouHear: parent.howDidYouHear,
            })) || []
        ) || [];

      // Emergency
      const emergency =
        booking.students?.flatMap((student) =>
          student.emergencyContacts?.map((em) => ({
            emergencyFirstName: em.emergencyFirstName,
            emergencyLastName: em.emergencyLastName,
            emergencyPhoneNumber: em.emergencyPhoneNumber,
            emergencyRelation: em.emergencyRelation,
          }))
        )?.[0] || null;

      // Payment
      let parsedGatewayResponse = {};
      let parsedTransactionMeta = {};

      try {
        if (payment?.gatewayResponse) {
          parsedGatewayResponse =
            typeof payment.gatewayResponse === "string"
              ? JSON.parse(payment.gatewayResponse)
              : payment.gatewayResponse;
        }
      } catch (e) {
        console.error("Invalid gatewayResponse JSON", e);
      }

      try {
        if (payment?.transactionMeta) {
          parsedTransactionMeta =
            typeof payment.transactionMeta === "string"
              ? JSON.parse(payment.transactionMeta)
              : payment.transactionMeta;
        }
      } catch (e) {
        console.error("Invalid transactionMeta JSON", e);
      }

      // Combine all payment info into a fully structured object
      const paymentData = payment
        ? {
          id: payment.id,
          bookingId: payment.bookingId,
          firstName: payment.firstName,
          lastName: payment.lastName,
          email: payment.email,
          billingAddress: payment.billingAddress,
          cardHolderName: payment.cardHolderName,
          cv2: payment.cv2,
          expiryDate: payment.expiryDate,
          paymentType: payment.paymentType,
          pan: payment.pan,
          paymentStatus: payment.paymentStatus,
          referenceId: payment.referenceId,
          currency: payment.currency,
          merchantRef: payment.merchantRef,
          description: payment.description,
          commerceType: payment.commerceType,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          gatewayResponse: parsedGatewayResponse, // fully parsed JSON
          transactionMeta: parsedTransactionMeta, // fully parsed JSON
          totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
        }
        : null;

      return {
        bookingId: booking.id,
        status: booking.status,
        startDate: booking.startDate,
        dateBooked: booking.createdAt,

        // Full classSchedule + venue
        classSchedule: booking.classSchedule || null,
        venue: venue || null,

        bookedBy: booking.admin
          ? {
            id: booking.admin.id,
            firstName: booking.admin.firstName,
            lastName: booking.admin.lastName,
            email: booking.admin.email,
            role: booking.admin.role,
          }
          : null,

        // totalStudents: students.length,
        students,
        parents,
        emergency,

        paymentPlanData: plan
          ? {
            id: plan.id,
            title: plan.title,
            price: plan.price,
            joiningFee: plan.joiningFee,
            duration: plan.duration,
          }
          : null,

        payment: paymentData,
      };
    });

    // -------------------------------
    // Collect all unique venues
    // -------------------------------
    const venueMap = {};
    bookings.forEach((b) => {
      if (b.classSchedule?.venue) {
        venueMap[b.classSchedule.venue.id] = b.classSchedule.venue;
      }
    });
    const allVenues = Object.values(venueMap);

    // -------------------------------
    // Collect all unique bookedByAdmins
    // -------------------------------
    const adminMap = {};
    bookings.forEach((b) => {
      if (b.admin) {
        adminMap[b.admin.id] = {
          id: b.admin.id,
          firstName: b.admin.firstName,
          lastName: b.admin.lastName,
          email: b.admin.email,
          role: b.admin.role,
        };
      }
    });
    const allAdmins = Object.values(adminMap);

    // -------------------------------
    // Stats Calculation
    // -------------------------------
    const totalSales = memberShipSales.length;

    const totalRevenue = memberShipSales.reduce((acc, b) => {
      const plan = b.paymentPlanData;
      if (plan && plan.price != null) {
        const studentsCount = b.students?.length || 1;
        return acc + (plan.price + (plan.joiningFee || 0)) * studentsCount;
      }
      return acc;
    }, 0);

    const avgMonthlyFeeRaw =
      memberShipSales.reduce((acc, b) => {
        const plan = b.paymentPlanData;
        if (plan && plan.duration && plan.price != null) {
          const studentsCount = b.students?.length || 1;
          const monthlyFee =
            (plan.price + (plan.joiningFee || 0)) / plan.duration;
          return acc + monthlyFee * studentsCount;
        }
        return acc;
      }, 0) / (totalSales || 1);

    // ✅ Round to 2 decimals
    const avgMonthlyFee = Math.round(avgMonthlyFeeRaw * 100) / 100;

    const topSaleAgent = memberShipSales.length > 0 ? 1 : 0; // placeholder

    const stats = {
      totalSales: { value: totalSales, change: 0 },
      totalRevenue: { value: totalRevenue, change: 0 },
      avgMonthlyFee: { value: avgMonthlyFee, change: 0 },
      topSaleAgent: { value: topSaleAgent, change: 0 },
    };

    // -------------------------------
    // Final response
    // -------------------------------
    return {
      status: true,
      message: "Paid bookings retrieved successfully",
      data: {
        memberShipSales,
        venue: allVenues, // ✅ all unique venues
        bookedByAdmins: allAdmins, // ✅ all unique bookedByAdmins
      },
      stats,
    };
  } catch (error) {
    console.error("❌ getActiveMembershipBookings Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.sendActiveMemberSaleEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch main booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Get all students for this booking
    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });

    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 3️⃣ Venue & Class info
    const venue = await Venue.findByPk(booking.venueId);
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

    const venueName = venue?.venueName || venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const classTime =
      classSchedule?.classTime || classSchedule?.startTime || "TBA";
    const startDate = booking.startDate;
    const additionalNote = booking.additionalNote || "";

    // 4️⃣ Email template
    const emailConfigResult = await getEmailConfig(
      "admin",
      "send-email-membership"
    );
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Build students block (all in one list)
    let studentsHtml = "<ul>";
    for (const s of studentMetas) {
      studentsHtml += `<li>${s.studentFirstName} ${s.studentLastName} (Age: ${s.age}, Gender: ${s.gender})</li>`;
    }
    studentsHtml += "</ul>";

    // 6️⃣ Get unique parents across all students
    const allParents = await BookingParentMeta.findAll({
      where: { studentId: studentMetas.map((s) => s.id) },
    });

    const parentsMap = {};
    for (const parent of allParents) {
      if (parent?.parentEmail) {
        parentsMap[parent.parentEmail] = parent;
      }
    }

    // 7️⃣ Send one email per parent with all students listed
    for (const parentEmail in parentsMap) {
      const parent = parentsMap[parentEmail];

      let noteHtml = "";
      if (additionalNote && additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      let finalHtml = htmlTemplate
        .replace(/{{parentName}}/g, parent.parentFirstName)
        .replace(/{{studentsList}}/g, studentsHtml)
        .replace(/{{status}}/g, booking.status)
        .replace(/{{venueName}}/g, venueName)
        .replace(/{{className}}/g, className)
        .replace(/{{classTime}}/g, classTime)
        .replace(/{{startDate}}/g, startDate)
        .replace(/{{additionalNoteSection}}/g, noteHtml)
        .replace(/{{appName}}/g, "Synco")
        .replace(
          /{{logoUrl}}/g,
          "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
        )
        .replace(
          /{{kidsPlaying}}/g,
          "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
        )
        .replace(/{{year}}/g, new Date().getFullYear());

      const recipient = [
        {
          name: `${parent.parentFirstName} ${parent.parentLastName}`,
          email: parent.parentEmail,
        },
      ];

      const sendResult = await sendEmail(emailConfig, {
        recipient,
        subject,
        htmlBody: finalHtml,
      });

      if (sendResult.status) {
        sentTo.push(parent.parentEmail);
      }
    }

    return {
      status: true,
      message: `Emails sent to ${sentTo.length} parents`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendActiveMemberSaleEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

exports.transferClass = async (data, options) => {
  const t = await sequelize.transaction();
  try {
    const adminId = options?.adminId || null;

    // 🔹 Step 1: Find Booking
    const booking = await Booking.findByPk(data.bookingId, { transaction: t });
    if (!booking) throw new Error("Booking not found.");

    // 🔹 Step 2: Validate new ClassSchedule
    const newClassSchedule = await ClassSchedule.findByPk(
      data.classScheduleId, // ✅ match your payload
      { transaction: t }
    );
    if (!newClassSchedule) throw new Error("New class schedule not found.");

    // 🔹 Step 3: Validate Venue
    let newVenueId = data.venueId || newClassSchedule.venueId;
    if (newVenueId) {
      const newVenue = await Venue.findByPk(newVenueId, { transaction: t });
      if (!newVenue) throw new Error("New venue not found.");
    }

    // 🔹 Step 4: Update Booking
    booking.classScheduleId = data.classScheduleId;
    booking.venueId = newVenueId;
    booking.updatedAt = new Date();
    await booking.save({ transaction: t });

    // 🔹 Step 5: Upsert CancelBooking
    const existingCancel = await CancelBooking.findOne({
      where: { bookingId: booking.id, bookingType: "membership" },
      transaction: t,
    });

    if (existingCancel) {
      await existingCancel.update(
        {
          transferReasonClass: data.transferReasonClass,
          updatedAt: new Date(),
          createdBy: adminId,
        },
        { transaction: t }
      );
    } else {
      await CancelBooking.create(
        {
          bookingId: booking.id,
          bookingType: "membership",
          transferReasonClass: data.transferReasonClass,
          createdBy: adminId,
        },
        { transaction: t }
      );
    }

    // 🔹 Step 6: Commit
    await t.commit();

    return {
      status: true,
      message: "Class transferred successfully.",
      data: {
        bookingId: booking.id,
        classScheduleId: booking.classScheduleId,
        venueId: booking.venueId,
        transferReasonClass: data.transferReasonClass,
      },
    };
  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

// exports.addToWaitingListService = async (data, adminId) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🚀 [Service] addToWaitingListService started", {
//       data,
//       adminId,
//     });

//     // 1️⃣ Fetch original booking with relations
//     const originalBooking = await Booking.findByPk(data.bookingId, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//         { model: BookingPayment, as: "payments" }, // payments under booking
//       ],
//       transaction: t,
//     });

//     if (!originalBooking) throw new Error("Invalid booking selected.");

//     // ✅ Only clone from paid + active bookings
//     if (
//       !(
//         originalBooking.bookingType === "paid" &&
//         originalBooking.status === "active"
//       )
//     ) {
//       throw new Error(
//         `Booking type=${originalBooking.bookingType}, status=${originalBooking.status}. Cannot add to waiting list.`
//       );
//     }

//     // Validate venue and class schedule
//     const venue = await Venue.findByPk(data.venueId, { transaction: t });
//     if (!venue) throw new Error("Venue is required.");

//     const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
//       transaction: t,
//     });
//     if (!classSchedule) throw new Error("Class schedule is required.");

//     // Prevent duplicate waiting list entries
//     const studentIds = originalBooking.students.map((s) => s.id);
//     const existingWaiting = await Booking.findOne({
//       where: { classScheduleId: data.classScheduleId, status: "waiting list" },
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           where: { id: studentIds },
//         },
//       ],
//       transaction: t,
//     });

//     if (existingWaiting)
//       throw new Error(
//         "One or more students already have a waiting list entry for this class."
//       );

//     // 2️⃣ Create new waiting list booking (clone paymentPlanId from originalBooking)
//     const waitingBooking = await Booking.create(
//       {
//         bookingId: generateBookingId(),
//         bookingType: "waiting list",
//         venueId: data.venueId,
//         classScheduleId: data.classScheduleId,
//         paymentPlanId: originalBooking.paymentPlanId || null, // clone value, keep null if original is null
//         startDate: data.startDate || null,
//         additionalNote: data.additionalNote || null,
//         bookedBy: adminId,
//         status: "waiting list",
//         totalStudents: originalBooking.totalStudents || 1,
//         interest: originalBooking.interest || "medium",
//         // keyInformation: originalBooking.keyInformation || null,
//       },
//       { transaction: t }
//     );

//     // 3️⃣ Clone payments (linked to booking)
//     for (const payment of originalBooking.payments || []) {
//       await BookingPayment.create(
//         {
//           bookingId: waitingBooking.id,
//           firstName: payment.firstName,
//           lastName: payment.lastName,
//           email: payment.email,
//           billingAddress: payment.billingAddress,
//           cardHolderName: payment.cardHolderName,
//           cv2: payment.cv2,
//           expiryDate: payment.expiryDate,
//           paymentType: payment.paymentType,
//           pan: payment.pan,
//           paymentStatus: payment.paymentStatus,
//           referenceId: payment.referenceId,
//           currency: payment.currency,
//           merchantRef: payment.merchantRef,
//           description: payment.description,
//           commerceType: payment.commerceType,
//           gatewayResponse: payment.gatewayResponse,
//           transactionMeta: payment.transactionMeta,
//         },
//         { transaction: t }
//       );
//     }

//     // 4️⃣ Clone students + parents + emergency contacts
//     for (const student of originalBooking.students) {
//       const newStudent = await BookingStudentMeta.create(
//         {
//           bookingTrialId: waitingBooking.id,
//           studentFirstName: student.studentFirstName,
//           studentLastName: student.studentLastName,
//           dateOfBirth: student.dateOfBirth,
//           age: student.age,
//           gender: student.gender,
//           medicalInformation: student.medicalInformation,
//         },
//         { transaction: t }
//       );

//       for (const parent of student.parents || []) {
//         await BookingParentMeta.create(
//           {
//             studentId: newStudent.id,
//             parentFirstName: parent.parentFirstName,
//             parentLastName: parent.parentLastName,
//             parentEmail: parent.parentEmail,
//             parentPhoneNumber: parent.parentPhoneNumber,
//             relationToChild: parent.relationToChild,
//             howDidYouHear: parent.howDidYouHear,
//           },
//           { transaction: t }
//         );
//       }

//       for (const emergency of student.emergencyContacts || []) {
//         await BookingEmergencyMeta.create(
//           {
//             studentId: newStudent.id,
//             emergencyFirstName: emergency.emergencyFirstName,
//             emergencyLastName: emergency.emergencyLastName,
//             emergencyPhoneNumber: emergency.emergencyPhoneNumber,
//             emergencyRelation: emergency.emergencyRelation,
//           },
//           { transaction: t }
//         );
//       }
//     }

//     // 5️⃣ Reload new booking with relations before commit
//     const finalBooking = await Booking.findByPk(waitingBooking.id, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//         { model: BookingPayment, as: "payments" },
//       ],
//       transaction: t,
//     });

//     // 6️⃣ Commit transaction
//     await t.commit();

//     // 7️⃣ Simplified response
//     const simplified = {
//       venueId: finalBooking.venueId,
//       classScheduleId: finalBooking.classScheduleId,
//       paymentPlanId: finalBooking.paymentPlanId,
//       startDate: finalBooking.startDate,
//       totalStudents: finalBooking.totalStudents,
//       // keyInformation: finalBooking.keyInformation,
//       students: finalBooking.students.map((s) => ({
//         studentFirstName: s.studentFirstName,
//         studentLastName: s.studentLastName,
//         dateOfBirth: s.dateOfBirth,
//         age: s.age,
//         gender: s.gender,
//         medicalInformation: s.medicalInformation,
//       })),
//       parents: finalBooking.students.flatMap((s) =>
//         (s.parents || []).map((p) => ({
//           parentFirstName: p.parentFirstName,
//           parentLastName: p.parentLastName,
//           parentEmail: p.parentEmail,
//           parentPhoneNumber: p.parentPhoneNumber,
//           relationToChild: p.relationToChild,
//           howDidYouHear: p.howDidYouHear,
//         }))
//       ),
//       emergency:
//         finalBooking.students
//           .flatMap((s) => s.emergencyContacts || [])
//           .map((e) => ({
//             emergencyFirstName: e.emergencyFirstName,
//             emergencyLastName: e.emergencyLastName,
//             emergencyPhoneNumber: e.emergencyPhoneNumber,
//             emergencyRelation: e.emergencyRelation,
//           }))[0] || null,
//     };

//     return {
//       status: true,
//       message: "Booking added to waiting list successfully.",
//       data: simplified,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ [Service] addToWaitingListService error:", error);
//     return {
//       status: false,
//       message: error.message || "Server error.",
//       data: null,
//     };
//   }
// };
// exports.addToWaitingListService = async (data, adminId) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🚀 [Service] addToWaitingListService (update existing)", {
//       data,
//       adminId,
//     });

//     // 1️⃣ Fetch the existing booking
//     const booking = await Booking.findByPk(data.bookingId, {
//       include: [
//         { model: BookingStudentMeta, as: "students" },
//         { model: BookingPayment, as: "payments" },
//       ],
//       transaction: t,
//     });

//     if (!booking) throw new Error("Invalid booking selected.");

//     // 2️⃣ Handle "request to cancel" case
//     if (booking.status === "request_to_cancel" || booking.status === "cancelled") {
//       // 🔹 Remove entry from cancel booking table
//       const existingCancel = await CancelBooking.findOne({
//         where: { bookingId: booking.id },
//         transaction: t,
//       });

//       if (existingCancel) {
//         await CancelBooking.destroy({
//           where: { bookingId: booking.id },
//           transaction: t,
//         });
//         console.log("🧹 Removed cancel booking entry for:", booking.id);
//       }

//       // ✅ Update booking to waiting list
//       await booking.update(
//         {
//           status: "waiting list",
//           serviceType: data.serviceType || "weekly class trial",
//           venueId: data.venueId,
//           classScheduleId: data.classScheduleId,
//           startDate: null, // ⬅️ Force reset startDate
//           additionalNote: data.additionalNote || booking.additionalNote,
//           paymentPlanId: data.paymentPlanId,
//           bookedBy: adminId,
//         },
//         { transaction: t }
//       );

//       await t.commit();
//       const updatedBooking = await Booking.findByPk(booking.id, {
//         include: [
//           {
//             model: BookingStudentMeta,
//             as: "students",
//             include: [
//               { model: BookingParentMeta, as: "parents" },
//               { model: BookingEmergencyMeta, as: "emergencyContacts" },
//             ],
//           },
//         ],
//       });

//       return {
//         status: true,
//         message: "Booking moved from cancellation to waiting list successfully.",
//         data: updatedBooking,
//       };
//     }

//     // 3️⃣ For normal cases (active/paid bookings)
//     if (!(booking.bookingType === "paid" && booking.status === "active")) {
//       throw new Error(
//         `Booking type=${booking.bookingType}, status=${booking.status}. Cannot move to waiting list.`
//       );
//     }

//     // 4️⃣ Validate venue and class schedule (optional)
//     const venue = await Venue.findByPk(data.venueId, { transaction: t });
//     if (!venue) throw new Error("Venue is required.");

//     const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
//       transaction: t,
//     });
//     if (!classSchedule) throw new Error("Class schedule is required.");

//     // 5️⃣ Delete existing payments
//     // if (booking.payments?.length) {
//     //   const paymentIds = booking.payments.map((p) => p.id);
//     //   await BookingPayment.destroy({
//     //     where: { id: paymentIds },
//     //     transaction: t,
//     //   });
//     // }

//     // 6️⃣ Update booking to waiting list
//     await booking.update(
//       {
//         bookingType: "waiting list",
//         status: "waiting list",
//         serviceType: data.serviceType || "weekly class trial",
//         venueId: data.venueId,
//         classScheduleId: data.classScheduleId,
//         paymentPlanId: data.paymentPlanId,
//         startDate: data.startDate || booking.startDate,
//         additionalNote: data.additionalNote || booking.additionalNote,
//         // paymentPlanId: null,
//         // updatedBy: adminId,
//       },
//       { transaction: t }
//     );

//     await t.commit();

//     // 7️⃣ Fetch updated booking
//     const updatedBooking = await Booking.findByPk(booking.id, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//       ],
//     });

//     return {
//       status: true,
//       message: "Booking moved to waiting list successfully.",
//       data: updatedBooking,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ [Service] addToWaitingListService error:", error);
//     return {
//       status: false,
//       message: error.message || "Server error.",
//       data: null,
//     };
//   }
// };

// exports.addToWaitingListService = async (data, adminId) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🚀 [Service] addToWaitingListService (simplified)", {
//       data,
//       adminId,
//     });

//     // 1️⃣ Fetch existing booking
//     const booking = await Booking.findByPk(data.bookingId, {
//       include: [
//         { model: BookingStudentMeta, as: "students" },
//         { model: BookingPayment, as: "payments" },
//       ],
//       transaction: t,
//     });

//     if (!booking) throw new Error("Invalid booking selected.");

//     // 2️⃣ Validate normal case (only allow active/paid bookings)
//     if (!(booking.bookingType === "paid" && booking.status === "active")) {
//       throw new Error(
//         `Booking type=${booking.bookingType}, status=${booking.status}. Cannot move to waiting list.`
//       );
//     }

//     // 3️⃣ Validate class schedule if provided
//     if (data.classScheduleId) {
//       const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
//         transaction: t,
//       });
//       if (!classSchedule) throw new Error("Class schedule is required.");
//     }

//     // 4️⃣ Only update required fields
//     const updateFields = {
//       status: "waiting list",
//       serviceType: "weekly class trial",
//       classScheduleId: data.classScheduleId || booking.classScheduleId,
//       additionalNote: data.additionalNote || booking.additionalNote,
//     };

//     // 5️⃣ Conditionally update startDate
//     if (data.preferedStartDate) {
//       updateFields.startDate = data.preferedStartDate;
//     } else if (data.startDate) {
//       updateFields.startDate = data.startDate;
//     }
//     // else do not touch booking.startDate

//     await booking.update(updateFields, { transaction: t });

//     await t.commit();

//     // 6️⃣ Fetch updated booking for return
//     const updatedBooking = await Booking.findByPk(booking.id, {
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents" },
//             { model: BookingEmergencyMeta, as: "emergencyContacts" },
//           ],
//         },
//       ],
//     });

//     return {
//       status: true,
//       message: "Booking updated to waiting list successfully.",
//       data: updatedBooking,
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ [Service] addToWaitingListService error:", error);
//     return {
//       status: false,
//       message: error.message || "Server error.",
//       data: null,
//     };
//   }
// };

exports.addToWaitingListService = async (data, adminId) => {
  const t = await sequelize.transaction();
  try {
    console.log("🚀 [Service] addToWaitingListService (simplified)", {
      data,
      adminId,
    });

    // 1️⃣ Fetch existing booking
    const booking = await Booking.findByPk(data.bookingId, {
      include: [
        { model: BookingStudentMeta, as: "students" },
        { model: BookingPayment, as: "payments" },
      ],
      transaction: t,
    });

    if (!booking) throw new Error("Invalid booking selected.");

    // 2️⃣ Validate normal case (allow active/paid bookings or cancelled/request_to_cancel)
    const allowedStatuses = [
      "active",
      "cancelled",
      "request_to_cancel",
      "frozen",
    ];
    if (
      !(
        booking.bookingType === "paid" &&
        allowedStatuses.includes(booking.status)
      )
    ) {
      throw new Error(
        `Booking type=${booking.bookingType}, status=${booking.status}. Cannot move to waiting list.`
      );
    }

    // 3️⃣ Validate class schedule if provided
    if (data.classScheduleId) {
      const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
        transaction: t,
      });
      if (!classSchedule) throw new Error("Class schedule is required.");
    }

    // 4️⃣ Only update required fields
    const updateFields = {
      status: "waiting list",
      serviceType: "weekly class trial",
      classScheduleId: data.classScheduleId || booking.classScheduleId,
      additionalNote: data.additionalNote || booking.additionalNote,
    };

    // 5️⃣ Conditionally update startDate
    if (data.preferedStartDate) {
      updateFields.startDate = data.preferedStartDate;
    } else if (data.startDate) {
      updateFields.startDate = data.startDate;
    }
    // else do not touch booking.startDate

    await booking.update(updateFields, { transaction: t });

    await t.commit();

    // 6️⃣ Fetch updated booking for return
    const updatedBooking = await Booking.findByPk(booking.id, {
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
      ],
    });

    return {
      status: true,
      message: "Booking updated to waiting list successfully.",
      data: updatedBooking,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ [Service] addToWaitingListService error:", error);
    return {
      status: false,
      message: error.message || "Server error.",
      data: null,
    };
  }
};

exports.getWaitingList = async () => {
  try {
    const waitingListEntries = await WaitingList.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          include: [
            {
              model: BookingStudentMeta,
              as: "students",
              include: [
                { model: BookingParentMeta, as: "parents" },
                { model: BookingEmergencyMeta, as: "emergencyContacts" },
              ],
            },
          ],
        },
        { model: Venue, as: "venue" },
        { model: ClassSchedule, as: "classSchedule" },
      ],
      order: [["createdAt", "DESC"]],
    });

    const formattedData = waitingListEntries.map((entry) => {
      const booking = entry.booking;

      const students = booking.students.map((student) => ({
        studentFirstName: student.studentFirstName,
        studentLastName: student.studentLastName,
        dateOfBirth: student.dateOfBirth,
        age: student.age,
        gender: student.gender,
        medicalInformation: student.medicalInformation,
      }));

      const parents = booking.students.flatMap((student) =>
        student.parents.map((p) => ({
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        }))
      );

      const emergencyContactRaw =
        booking.students[0]?.emergencyContacts?.[0] || null;

      const emergency = emergencyContactRaw
        ? {
          emergencyFirstName: emergencyContactRaw.emergencyFirstName,
          emergencyLastName: emergencyContactRaw.emergencyLastName,
          emergencyPhoneNumber: emergencyContactRaw.emergencyPhoneNumber,
          emergencyRelation: emergencyContactRaw.emergencyRelation,
        }
        : null;

      return {
        id: entry.id,
        bookingId: booking.id, // <-- bookingId included
        venue: entry.venue,
        classSchedule: entry.classSchedule,

        students,
        parents,
        emergency,
      };
    });

    return {
      status: true,
      data: formattedData,
      message: "Waiting list retrieved successfully",
    };
  } catch (error) {
    console.error("❌ getWaitingList service error:", error);
    return { status: false, message: error.message };
  }
};

exports.getBookingsById = async (bookingId) => {
  try {
    const booking = await Booking.findOne({
      where: {
        id: bookingId,
        bookingType: { [Op.or]: ["waiting list", "paid", "removed"] }, // <-- both types
        // serviceType: "weekly class membership",
        serviceType: {
          [Op.in]: ["weekly class membership", "weekly class trial"], // ✅ both types
        },
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          include: [{ model: Venue, as: "venue", required: false }],
        },
        { model: BookingPayment, as: "payments", required: false },
        { model: PaymentPlan, as: "paymentPlan", required: false },
        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
            "profile",
          ],
          required: false,
        },
        {
          model: FreezeBooking,
          as: "freezeBooking",
          required: false,
        },
      ],
    });

    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // ✅ extract venueId from this booking
    const venueId = booking.classSchedule?.venue?.id || null;

    let newClasses = [];
    if (venueId) {
      // 🔎 find all other class schedules in the same venue
      newClasses = await ClassSchedule.findAll({
        where: { venueId },
      });
    }

    // ✅ Parse booking as before
    const students =
      booking.students?.map((s) => ({
        id: s.id, // <-- DB id
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    const parents =
      booking.students?.flatMap(
        (s) =>
          s.parents?.map((p) => ({
            id: p.id, // <-- DB id
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || []
      ) || [];

    const emergency =
      booking.students?.flatMap(
        (s) =>
          s.emergencyContacts?.map((e) => ({
            id: e.id, // <-- DB id
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || []
      ) || [];

    const venue = booking.classSchedule?.venue || null;
    const plan = booking.paymentPlan || null;

    const payments =
      booking.payments?.map((p) => ({
        ...p.get({ plain: true }),
        gatewayResponse: (() => {
          try {
            return JSON.parse(p.gatewayResponse);
          } catch {
            return p.gatewayResponse;
          }
        })(),
        transactionMeta: (() => {
          try {
            return JSON.parse(p.transactionMeta);
          } catch {
            return p.transactionMeta;
          }
        })(),
      })) || [];

    const payment = payments[0] || null;

    const parsedBooking = {
      bookingId: booking.id,
      bookedId: booking.bookingId,
      freezeBooking: booking.freezeBooking,
      serviceType: booking.serviceType,
      status: booking.status,
      startDate: booking.startDate,
      dateBooked: booking.createdAt,

      students,
      parents,
      emergency,

      classSchedule: booking.classSchedule || null,
      venue,
      paymentPlan: plan,
      payments,

      paymentData: payment
        ? {
          firstName: payment.firstName,
          lastName: payment.lastName,
          email: payment.email,
          billingAddress: payment.billingAddress,
          paymentStatus: payment.paymentStatus,
          totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
        }
        : null,

      bookedByAdmin: booking.bookedByAdmin || null,
      newClasses,
    };

    return {
      status: true,
      message: "Paid booking retrieved successfully",
      totalPaidBookings: 1,
      data: parsedBooking,
    };
  } catch (error) {
    console.error("❌ getBookingsById Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.retryBookingPayment = async (bookingId, newData) => {
  console.log(
    "🔹 [Service] Starting retryBookingPayment for bookingId:",
    bookingId
  );

  const t = await sequelize.transaction();
  try {
    // Step 1: Find Booking
    const booking = await Booking.findByPk(bookingId, { transaction: t });
    if (!booking) throw new Error("Booking not found");
    console.log("✅ [Service] Booking found:", booking.id);

    // Step 2: Find latest payment
    const latestPayment = await BookingPayment.findOne({
      where: { bookingId: booking.id },
      order: [["createdAt", "DESC"]],
      transaction: t,
    });
    if (!latestPayment) throw new Error("No payment found to retry");

    if (latestPayment.paymentStatus === "paid") {
      console.log("⚠️ Payment already successful, nothing to retry.");
      await t.commit();
      return {
        status: true,
        message: "Payment already successful, nothing to retry.",
        paymentStatus: "paid",
        studentId: booking.studentId,
      };
    }

    // Step 3: Load plan
    if (newData.paymentPlanId) {
      booking.paymentPlanId = newData.paymentPlanId;
      await booking.save({ transaction: t });
      console.log("✅ Booking plan updated");
    }

    const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
      transaction: t,
    });
    if (!paymentPlan) throw new Error("Invalid payment plan selected.");
    const price = paymentPlan.price || 0;

    const venue = await Venue.findByPk(booking.venueId, { transaction: t });
    const classSchedule = await ClassSchedule.findByPk(
      booking.classScheduleId,
      { transaction: t }
    );

    const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;

    let paymentStatusFromGateway = "pending";
    let gatewayResponse = null;
    let transactionMeta = null;

    // Step 4: Retry payment
    // Step 4: Retry payment
    try {
      if (newData?.payment?.paymentType === "bank") {
        console.log("🔹 [Service] Retrying via GoCardless bank...");

        if (!newData.payment.referenceId)
          throw new Error("Reference ID is required for bank payments.");

        const gcPayload = {
          billing_requests: {
            payment_request: {
              amount: Math.round(price * 100), // in pence
              currency: "GBP",
              description: `Booking retry for ${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
                }`,
              metadata: {
                bookingId: String(booking.id), // must be string
                retry: "true", // must be string
                referenceId: newData.payment.referenceId,
              },
            },
            mandate_request: {
              currency: "GBP",
              scheme: "bacs",
              metadata: {
                bookingId: String(booking.id), // must be string
              },
            },
            metadata: { test: `BR${Math.floor(Math.random() * 1000000)}` },
            links: {},
          },
        };

        console.log("📦 bank Payload:", gcPayload);

        // ✅ Fetch GoCardless access token from AppConfig
        const gcAccessTokenConfig = await AppConfig.findOne({
          where: { key: "GOCARDLESS_ACCESS_TOKEN" },
          transaction: t,
        });

        if (!gcAccessTokenConfig || !gcAccessTokenConfig.value) {
          throw new Error("Missing GOCARDLESS_ACCESS_TOKEN in AppConfig table.");
        }

        const GOCARDLESS_ACCESS_TOKEN = gcAccessTokenConfig.value;

        // ✅ Make GoCardless API call
        const response = await axios.post(
          "https://api-sandbox.gocardless.com/billing_requests",
          gcPayload,
          {
            headers: {
              Authorization: `Bearer ${GOCARDLESS_ACCESS_TOKEN}`, // ✅ from DB, not env
              "Content-Type": "application/json",
              "GoCardless-Version": "2015-07-06",
            },
          }
        );

        gatewayResponse = response.data;
        console.log("✅ GoCardless Response:", gatewayResponse);

        const status =
          response.data?.billing_requests?.status?.toLowerCase() || "failed";

        transactionMeta = { status };

        if (["submitted", "pending_submission", "pending"].includes(status))
          paymentStatusFromGateway = "pending";
        else if (status === "confirmed" || status === "paid")
          paymentStatusFromGateway = "paid";
        else if (["failed", "cancelled"].includes(status))
          paymentStatusFromGateway = "failed";
        else paymentStatusFromGateway = "unknown";

        // Force failed if not paid or pending
        if (
          paymentStatusFromGateway !== "paid" &&
          paymentStatusFromGateway !== "pending"
        ) {
          paymentStatusFromGateway = "failed";
        }

        console.log(
          "🔹 [Service] Payment status mapped:",
          paymentStatusFromGateway
        );
      } else if (newData?.payment?.paymentType === "card") {
        console.log("🔹 [Service] Retrying via Pay360 card...");
        const { pan, expiryDate, cardHolderName, cv2 } = newData.payment || {};
        if (!pan || !expiryDate || !cardHolderName || !cv2)
          throw new Error("Missing required card details for Pay360 payment.");

        const paymentPayload = {
          transaction: {
            currency: "GBP",
            amount: price,
            merchantRef,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            commerceType: "ECOM",
          },
          paymentMethod: { card: { pan, expiryDate, cardHolderName, cv2 } },
        };

        console.log("📦 Pay360 Payload:", paymentPayload);

        // const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${process.env.PAY360_INST_ID}/payment`;
        // const authHeader = Buffer.from(
        //   `${process.env.PAY360_API_USERNAME}:${process.env.PAY360_API_PASSWORD}`
        // ).toString("base64");

        // ✅ Fetch Pay360 credentials from AppConfig
        const [instIdConfig, usernameConfig, passwordConfig] = await Promise.all([
          AppConfig.findOne({ where: { key: "PAY360_INST_ID" }, transaction: t }),
          AppConfig.findOne({ where: { key: "PAY360_API_USERNAME" }, transaction: t }),
          AppConfig.findOne({ where: { key: "PAY360_API_PASSWORD" }, transaction: t }),
        ]);

        if (!instIdConfig || !usernameConfig || !passwordConfig) {
          throw new Error("Missing Pay360 configuration in AppConfig table.");
        }

        const PAY360_INST_ID = instIdConfig.value;
        const PAY360_API_USERNAME = usernameConfig.value;
        const PAY360_API_PASSWORD = passwordConfig.value;

        // ✅ Construct Pay360 API URL dynamically
        const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${PAY360_INST_ID}/payment`;

        // ✅ Encode Basic Auth Header
        const authHeader = Buffer.from(
          `${PAY360_API_USERNAME}:${PAY360_API_PASSWORD}`
        ).toString("base64");

        const response = await axios.post(url, paymentPayload, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${authHeader}`,
          },
        });

        gatewayResponse = response.data;
        console.log("✅ Pay360 Response:", gatewayResponse);

        const status =
          response.data?.transaction?.status?.toLowerCase() || "failed";

        transactionMeta = { status };

        if (status === "success" || status === "already_paid")
          paymentStatusFromGateway = "paid";
        else if (status === "pending") paymentStatusFromGateway = "pending";
        else paymentStatusFromGateway = "failed";

        // Force failed if not paid or pending
        if (
          paymentStatusFromGateway !== "paid" &&
          paymentStatusFromGateway !== "pending"
        ) {
          paymentStatusFromGateway = "failed";
        }
      } else {
        throw new Error("Unsupported or missing payment type for retry.");
      }
    } catch (err) {
      console.error(
        "❌ Payment gateway error:",
        err.response?.data || err.message
      );
      paymentStatusFromGateway = "failed";
      gatewayResponse = err.response?.data || { error: err.message };
      transactionMeta = { status: "failed" };
    }

    // Step 5: Update existing BookingPayment
    console.log("🔹 [Service] Updating BookingPayment retry entry...");

    const existingPayment = await BookingPayment.findOne({
      where: { bookingId: booking.id },
      order: [["createdAt", "DESC"]],
      transaction: t,
    });

    if (!existingPayment) throw new Error("No payment record found to update.");

    const firstStudent = await BookingStudentMeta.findOne({
      where: { bookingTrialId: booking.id },
      order: [["createdAt", "ASC"]],
      transaction: t,
    });
    const firstParent = newData.parents?.[0] || {};

    await existingPayment.update(
      {
        studentId: firstStudent?.id || null,
        paymentType: newData.payment.paymentType,
        referenceId: newData.payment.referenceId || existingPayment.referenceId,
        paymentStatus: paymentStatusFromGateway,
        amount: price,
        gatewayResponse, // full raw payload
        transactionMeta, // only { status }
        firstName:
          newData.payment.firstName || firstParent.parentFirstName || "Parent",
        lastName: newData.payment.lastName || firstParent.parentLastName || "",
        merchantRef,
        description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
          }`,
        commerceType: "ECOM",
        email: newData.payment.email || firstParent.parentEmail || "",
        billingAddress: newData.payment.billingAddress || "",
        cardHolderName: newData.payment.cardHolderName || "",
        cv2: newData.payment.cv2 || "",
        expiryDate: newData.payment.expiryDate || "",
        pan: newData.payment.pan || "",
        updatedAt: new Date(),
      },
      { transaction: t }
    );

    console.log(
      `✅ [Service] BookingPayment retry updated with status: ${paymentStatusFromGateway}`
    );

    await t.commit();
    return {
      status: true,
      message: `Retry payment completed with status: ${paymentStatusFromGateway}`,
      paymentStatus: paymentStatusFromGateway,
      studentId: firstStudent?.id || null,
    };
  } catch (error) {
    console.error("❌ Error in retryBookingPayment:", error.message);
    await t.rollback();
    return { status: false, message: error.message };
  }
};

exports.getFailedPaymentsByBookingId = async (bookingId) => {
  if (!bookingId) {
    throw new Error("Booking ID is required");
  }

  const failedPayments = await BookingPayment.findAll({
    where: {
      bookingId,
      paymentStatus: "failed", // Only failed payments
    },
    order: [["createdAt", "DESC"]],
  });

  // Parse gatewayResponse and transactionMeta
  const parsedPayments = failedPayments.map((payment) => {
    let gatewayResponse = payment.gatewayResponse;
    let transactionMeta = payment.transactionMeta;
    let goCardlessCustomer = payment.goCardlessCustomer;
    let goCardlessBankAccount = payment.goCardlessBankAccount;
    let goCardlessBillingRequest = payment.goCardlessBillingRequest;

    // Ensure JSON parsing if stored as string
    if (typeof gatewayResponse === "string") {
      try {
        gatewayResponse = JSON.parse(gatewayResponse);
      } catch (err) {
        console.error("Failed to parse gatewayResponse:", err.message);
      }
    }

    if (typeof transactionMeta === "string") {
      try {
        transactionMeta = JSON.parse(transactionMeta);
      } catch (err) {
        console.error("Failed to parse transactionMeta:", err.message);
      }
    }

    if (typeof goCardlessCustomer === "string") {
      try {
        goCardlessCustomer = JSON.parse(goCardlessCustomer);
      } catch (err) {
        console.error("Failed to parse goCardlessCustomer:", err.message);
      }
    }
    if (typeof goCardlessBankAccount === "string") {
      try {
        goCardlessBankAccount = JSON.parse(goCardlessBankAccount);
      } catch (err) {
        console.error("Failed to parse goCardlessBankAccount:", err.message);
      }
    }
    if (typeof goCardlessBillingRequest === "string") {
      try {
        goCardlessBillingRequest = JSON.parse(goCardlessBillingRequest);
      } catch (err) {
        console.error("Failed to parse goCardlessBillingRequest:", err.message);
      }
    }

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      studentId: payment.studentId,
      paymentType: payment.paymentType,
      // amount: payment.amount,
      paymentStatus: payment.paymentStatus,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      gatewayResponse, // parsed object
      transactionMeta, // parsed object
      goCardlessCustomer,
      goCardlessBankAccount,
    };
  });

  return parsedPayments;
};

exports.updateBookingWithStudents = async (
  bookingId,
  studentsPayload,
  transaction
) => {
  try {
    // 🔹 Fetch booking with associations
    const booking = await Booking.findOne({
      where: { id: bookingId },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
        },
      ],
      transaction,
    });

    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 🔹 Update or create students, parents, emergency contacts
    for (const student of studentsPayload) {
      let studentRecord;

      // Update existing student
      if (student.id) {
        studentRecord = booking.students.find((s) => s.id === student.id);
        if (!studentRecord) continue;

        [
          "studentFirstName",
          "studentLastName",
          "dateOfBirth",
          "age",
          "gender",
          "medicalInformation",
        ].forEach((field) => {
          if (student[field] !== undefined)
            studentRecord[field] = student[field];
        });
        await studentRecord.save({ transaction });
      } else {
        // Create new student
        studentRecord = await BookingStudentMeta.create(
          { bookingId, ...student },
          { transaction }
        );
      }

      // Parents
      if (Array.isArray(student.parents)) {
        for (const parent of student.parents) {
          if (parent.id) {
            const parentRecord = studentRecord.parents?.find(
              (p) => p.id === parent.id
            );
            if (parentRecord) {
              [
                "parentFirstName",
                "parentLastName",
                "parentEmail",
                "parentPhoneNumber",
                "relationToChild",
                "howDidYouHear",
              ].forEach((field) => {
                if (parent[field] !== undefined)
                  parentRecord[field] = parent[field];
              });
              await parentRecord.save({ transaction });
            }
          } else {
            await BookingParentMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...parent },
              { transaction }
            );
          }
        }
      }

      // Emergency Contacts
      if (Array.isArray(student.emergencyContacts)) {
        for (const emergency of student.emergencyContacts) {
          if (emergency.id) {
            const emergencyRecord = studentRecord.emergencyContacts?.find(
              (e) => e.id === emergency.id
            );
            if (emergencyRecord) {
              [
                "emergencyFirstName",
                "emergencyLastName",
                "emergencyPhoneNumber",
                "emergencyRelation",
              ].forEach((field) => {
                if (emergency[field] !== undefined)
                  emergencyRecord[field] = emergency[field];
              });
              await emergencyRecord.save({ transaction });
            }
          } else {
            await BookingEmergencyMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...emergency },
              { transaction }
            );
          }
        }
      }
    }

    // 🔹 Prepare structured response like getBookingsById
    const students =
      booking.students?.map((s) => ({
        studentId: s.id,
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    const parents =
      booking.students?.flatMap(
        (s) =>
          s.parents?.map((p) => ({
            parentId: p.id,
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || []
      ) || [];

    const emergencyContacts =
      booking.students?.flatMap(
        (s) =>
          s.emergencyContacts?.map((e) => ({
            emergencyId: e.id,
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || []
      ) || [];

    return {
      status: true,
      message: "Booking updated successfully",
      data: {
        bookingId: booking.id,
        status: booking.status,
        students,
        parents,
        emergencyContacts,
      },
    };
  } catch (error) {
    console.error("❌ Service updateBookingWithStudents Error:", error.message);
    return { status: false, message: error.message };
  }
};

// exports.updateBooking = async (data, options) => {
//   console.log("🚀 Start updateBooking service");
//   const transaction = await sequelize.transaction();

//   try {
//     const adminId = options?.adminId || null;

//     // Step 1: Update Booking
//     console.log("🚀 Step 1: Updating booking:", data.bookingId);
//     const [affectedRows] = await Booking.update(
//       {
//         venueId: data.venueId,
//         bookingId: generateBookingId(12),
//         totalStudents: data.totalStudents,
//         classScheduleId: data.classScheduleId,
//         bookingType: data.paymentPlanId ? "paid" : "free",
//         paymentPlanId: data.paymentPlanId || null,
//         status: data.status || "active",
//         bookedBy: adminId,
//         updatedAt: new Date(),
//       },
//       { where: { id: data.bookingId }, transaction }
//     );

//     if (!affectedRows) throw new Error(`Booking with id ${data.bookingId} not found`);

//     // Step 2: Update Students
//     console.log("🚀 Step 2: Updating students");
//     const studentRecords = [];

//     for (const student of data.students) {
//       console.log("🔹 Processing student:", student);

//       let studentRecord;
//       if (student.id) {
//         studentRecord = await BookingStudentMeta.findByPk(student.id, { transaction });
//         if (!studentRecord) throw new Error(`Student with id ${student.id} not found`);

//         Object.assign(studentRecord, {
//           bookingTrialId: data.bookingId,
//           studentFirstName: student.studentFirstName,
//           studentLastName: student.studentLastName,
//           dateOfBirth: student.dateOfBirth,
//           age: student.age,
//           gender: student.gender,
//           medicalInformation: student.medicalInformation,
//           updatedAt: new Date(),
//         });

//         await studentRecord.save({ transaction });
//       } else {
//         studentRecord = await BookingStudentMeta.create(
//           {
//             bookingTrialId: data.bookingId,
//             studentFirstName: student.studentFirstName,
//             studentLastName: student.studentLastName,
//             dateOfBirth: student.dateOfBirth,
//             age: student.age,
//             gender: student.gender,
//             medicalInformation: student.medicalInformation,
//             createdAt: new Date(),
//             updatedAt: new Date(),
//           },
//           { transaction }
//         );
//       }

//       studentRecords.push(studentRecord);
//       console.log("✅ Student processed:", studentRecord.id);
//     }

//     // Step 3: Update Parents
//     console.log("🚀 Step 3: Updating parents");
//     if (data.parents?.length && studentRecords.length) {
//       const firstStudentId = studentRecords[0].id;

//       for (const parent of data.parents) {
//         const email = parent.parentEmail?.trim()?.toLowerCase();
//         if (!email) throw new Error("Parent email is required.");

//         const existingParent = await BookingParentMeta.findOne({
//           where: { studentId: firstStudentId, parentEmail: email },
//           transaction,
//         });
//         const existingAdmin = await Admin.findOne({ where: { email }, transaction });

//         if (existingParent || existingAdmin) {
//           throw new Error(`Parent with email ${email} already exists.`);
//         }

//         await BookingParentMeta.update(
//           {
//             studentId: firstStudentId,
//             parentFirstName: parent.parentFirstName,
//             parentLastName: parent.parentLastName,
//             parentEmail: email,
//             parentPhoneNumber: parent.parentPhoneNumber,
//             relationToChild: parent.relationToChild,
//             howDidYouHear: parent.howDidYouHear,
//             updatedAt: new Date(),
//           },
//           { where: { id: parent.id || 0 }, transaction }
//         );

//         console.log("✅ Parent and admin updated:", email);
//       }
//     }

//     // Step 4: Update Emergency Contact
//     console.log("🚀 Step 4: Updating emergency contact");
//     if (data.emergency) {
//       let emergencyRecord;
//       if (data.emergency.id) {
//         emergencyRecord = await BookingEmergencyMeta.findByPk(data.emergency.id, { transaction });
//         if (!emergencyRecord) throw new Error(`Emergency contact with id ${data.emergency.id} not found`);

//         Object.assign(emergencyRecord, {
//           bookingTrialId: data.bookingId,
//           emergencyFirstName: data.emergency.emergencyFirstName,
//           emergencyLastName: data.emergency.emergencyLastName,
//           emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
//           emergencyRelation: data.emergency.emergencyRelation,
//           updatedAt: new Date(),
//         });

//         await emergencyRecord.save({ transaction });
//       } else {
//         emergencyRecord = await BookingEmergencyMeta.create(
//           {
//             bookingTrialId: data.bookingId,
//             emergencyFirstName: data.emergency.emergencyFirstName,
//             emergencyLastName: data.emergency.emergencyLastName,
//             emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
//             emergencyRelation: data.emergency.emergencyRelation,
//             createdAt: new Date(),
//             updatedAt: new Date(),
//           },
//           { transaction }
//         );
//       }
//       console.log("✅ Emergency contact processed:", emergencyRecord.id);
//     }

//     // Step 5: Update Class Capacity
//     await transaction.commit();
//     console.log("✅ Transaction committed successfully");

//     return { status: true, data: { bookingId: data.bookingId, firstStudent: studentRecords[0] } };

//   } catch (error) {
//     await transaction.rollback();
//     console.error("❌ Transaction rolled back:", error.message);
//     return { status: false, message: error.message };
//   }
// };

// exports.updateBookingWithStudents = async (bookingId, studentsPayload, transaction) => {
//   // Fetch booking with associations
//   const booking = await Booking.findOne({
//     where: { id: bookingId },
//     include: [
//       {
//         model: BookingStudentMeta,
//         as: "students",
//         include: [
//           { model: BookingParentMeta, as: "parents" },
//           { model: BookingEmergencyMeta, as: "emergencyContacts" },
//         ],
//       },
//     ],
//     transaction,
//   });

//   if (!booking) throw new Error("Booking not found.");

//   for (const student of studentsPayload) {
//     let studentRecord;

//     if (student.id) {
//       // 🔹 Update existing student
//       studentRecord = booking.students.find((s) => s.id === student.id);
//       if (!studentRecord) continue;

//       const studentFields = [
//         "studentFirstName",
//         "studentLastName",
//         "dateOfBirth",
//         "age",
//         "gender",
//         "medicalInformation",
//       ];
//       studentFields.forEach((field) => {
//         if (student[field] !== undefined) studentRecord[field] = student[field];
//       });
//       await studentRecord.save({ transaction });
//     } else {
//       // 🔹 Create new student
//       studentRecord = await BookingStudentMeta.create(
//         {
//           bookingId,
//           studentFirstName: student.studentFirstName,
//           studentLastName: student.studentLastName,
//           dateOfBirth: student.dateOfBirth,
//           age: student.age,
//           gender: student.gender,
//           medicalInformation: student.medicalInformation,
//         },
//         { transaction }
//       );
//     }

//     // 🔹 Parents
//     if (Array.isArray(student.parents)) {
//       for (const parent of student.parents) {
//         if (parent.id) {
//           const parentRecord = studentRecord.parents?.find((p) => p.id === parent.id);
//           if (parentRecord) {
//             const parentFields = [
//               "parentFirstName",
//               "parentLastName",
//               "parentEmail",
//               "parentPhoneNumber",
//               "relationToChild",
//               "howDidYouHear",
//             ];
//             parentFields.forEach((field) => {
//               if (parent[field] !== undefined) parentRecord[field] = parent[field];
//             });
//             await parentRecord.save({ transaction });
//           }
//         } else {
//           await BookingParentMeta.create(
//             {
//               bookingStudentMetaId: studentRecord.id,
//               parentFirstName: parent.parentFirstName,
//               parentLastName: parent.parentLastName,
//               parentEmail: parent.parentEmail,
//               parentPhoneNumber: parent.parentPhoneNumber,
//               relationToChild: parent.relationToChild,
//               howDidYouHear: parent.howDidYouHear,
//             },
//             { transaction }
//           );
//         }
//       }
//     }

//     // 🔹 Emergency Contacts
//     if (Array.isArray(student.emergencyContacts)) {
//       for (const emergency of student.emergencyContacts) {
//         if (emergency.id) {
//           const emergencyRecord = studentRecord.emergencyContacts?.find((e) => e.id === emergency.id);
//           if (emergencyRecord) {
//             const emergencyFields = [
//               "emergencyFirstName",
//               "emergencyLastName",
//               "emergencyPhoneNumber",
//               "emergencyRelation",
//             ];
//             emergencyFields.forEach((field) => {
//               if (emergency[field] !== undefined) emergencyRecord[field] = emergency[field];
//             });
//             await emergencyRecord.save({ transaction });
//           }
//         } else {
//           await BookingEmergencyMeta.create(
//             {
//               bookingStudentMetaId: studentRecord.id,
//               emergencyFirstName: emergency.emergencyFirstName,
//               emergencyLastName: emergency.emergencyLastName,
//               emergencyPhoneNumber: emergency.emergencyPhoneNumber,
//               emergencyRelation: emergency.emergencyRelation,
//             },
//             { transaction }
//           );
//         }
//       }
//     }
//   }

//   return booking;
// };
