const { Op } = require("sequelize");
const {
  OneToOneBooking,
  OneToOneStudent,
  OneToOneParent,
  OneToOneEmergency,
  OneToOnePayment,
  PaymentPlan,
  Discount,
} = require("../../../../models");
const { sequelize } = require("../../../../models");

const stripe = require("../../../../utils/payment/pay360/stripe");
const {
  createCustomer,
  createCardToken,
  addNewCard,
  createCharges,
  getStripePaymentDetails,
} = require("../../../../controllers/test/payment/stripe/stripeController");

exports.createOnetoOneBooking = async (data) => {
  const transaction = await sequelize.transaction();
  try {
    // ✅ 0️⃣ Check if lead already booked
    if (data.leadId) {
      const existingBooking = await OneToOneBooking.findOne({
        where: { leadId: data.leadId },
      });

      if (existingBooking) {
        console.warn(
          `⚠️ Lead ID ${data.leadId} is already associated with Booking ID ${existingBooking.id}`
        );

        return {
          success: false,
          message: "You have already booked this lead.",
        };
      }
    }

    // 1️⃣ Calculate base amount & discount
    let paymentPlan = null;
    let baseAmount = 0;

    if (data.paymentPlanId) {
      paymentPlan = await PaymentPlan.findByPk(data.paymentPlanId);
      if (!paymentPlan) throw new Error("Invalid payment plan ID");
      baseAmount = paymentPlan.price || 0;
    }

    let discount = null;
    let discountAmount = 0;
    let finalAmount = baseAmount;

    if (data.discountId) {
      discount = await Discount.findByPk(data.discountId);
      if (!discount) throw new Error("Invalid discount ID");

      if (discount.value_type === "percentage") {
        discountAmount = (baseAmount * discount.value) / 100;
      } else if (discount.value_type === "fixed") {
        discountAmount = discount.value;
      }

      finalAmount = Math.max(baseAmount - discountAmount, 0);
    }

    // 2️⃣ Create booking
    const booking = await OneToOneBooking.create(
      {
        leadId: data.leadId || null,
        coachId: data.coachId,
        location: data.location,
        address: data.address,
        date: data.date,
        time: data.time,
        totalStudents: data.totalStudents,
        areaWorkOn: data.areaWorkOn,
        paymentPlanId: data.paymentPlanId || null,
        discountId: data.discountId || null,
        status: "pending",
      },
      { transaction }
    );

    // 3️⃣ Create students, parents, emergency
    const students = await Promise.all(
      (data.students || []).map((s) =>
        OneToOneStudent.create(
          {
            oneToOneBookingId: booking.id,
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInfo: s.medicalInfo,
          },
          { transaction }
        )
      )
    );

    const firstStudent = students[0];
    if (firstStudent) {
      if (data.parents?.length) {
        await Promise.all(
          data.parents.map((p) =>
            OneToOneParent.create(
              {
                studentId: firstStudent.id,
                parentFirstName: p.parentFirstName,
                parentLastName: p.parentLastName,
                parentEmail: p.parentEmail,
                phoneNumber: p.phoneNumber,
                relationChild: p.relationChild,
                howDidHear: p.howDidHear,
              },
              { transaction }
            )
          )
        );
      }

      if (data.emergency) {
        await OneToOneEmergency.create(
          {
            studentId: firstStudent.id,
            emergencyFirstName: data.emergency.emergencyFirstName,
            emergencyLastName: data.emergency.emergencyLastName,
            phoneNumber: data.emergency.emergencyPhoneNumber,
            relationChild: data.emergency.emergencyRelation,
          },
          { transaction }
        );
      }
    }

    // 4️⃣ Stripe Payment Logic
    let paymentStatus = "failed";
    let stripeChargeId = null;
    let errorMessage = null;

    try {
      let customerId = data.payment?.customer_id;
      let cardId = data.payment?.card_id;

      // 🧩 Step 1: Create Customer if not exists
      if (!customerId) {
        const customerRes = await createCustomer({
          body: {
            name: `${data.payment.firstName} ${data.payment.lastName}`,
            email: data.payment.email,
          },
        });
        customerId = customerRes.customer_id;
      }

      // 🧩 Step 2: Create Card Token and attach to Customer
      if (!cardId) {
        const cardTokenRes = await createCardToken({
          body: {
            cardNumber: data.payment.cardNumber,
            expiryMonth: data.payment.expiryMonth,
            expiryYear: data.payment.expiryYear,
            securityCode: data.payment.securityCode,
          },
        });
        const token_id = cardTokenRes.token_id;

        const addCardRes = await addNewCard({
          body: {
            customer_id: customerId,
            card_token: token_id,
          },
        });

        cardId = addCardRes.card_id;
      }

      // 🧩 Step 3: Create Charge
      const chargeRes = await createCharges({
        body: {
          amount: finalAmount,
          customer_id: customerId,
          card_id: cardId,
        },
      });

      if (chargeRes.status === "succeeded") {
        paymentStatus = "paid";
        stripeChargeId = chargeRes.charge_id;
      }
    } catch (err) {
      console.error("❌ Stripe Payment Error:", err.message);
      errorMessage = err.message;
    }

    // 5️⃣ Record payment
    await OneToOnePayment.create(
      {
        oneToOneBookingId: booking.id,
        amount: finalAmount,
        discountAmount,
        baseAmount,
        paymentStatus, // ✅ comes directly from gateway
        stripePaymentIntentId: stripeChargeId,
        paymentDate: new Date(),
        failureReason: errorMessage,
      },
      { transaction }
    );

    booking.status = "pending";

    await booking.save({ transaction });
    console.log("🟡 Before save:", booking.status);
    await booking.save({ transaction });
    console.log("🟢 After save, re-fetching...");

    // ✅ 7️⃣ Optionally fetch charge details from Stripe (if charge succeeded)
    let stripeChargeDetails = null;
    if (stripeChargeId) {
      try {
        stripeChargeDetails = await stripe.charges.retrieve(stripeChargeId);
      } catch (err) {
        console.error("⚠️ Failed to fetch charge details:", err.message);
      }
    }

    await transaction.commit();

    // ✅ Return response including Stripe details
    return {
      success: true,
      bookingId: booking.id,
      paymentStatus, // "paid" or "failed"
      stripePaymentIntentId: stripeChargeId, // ✅ charge id like ch_xxx
      baseAmount,
      discountAmount,
      finalAmount,
      stripeChargeDetails: stripeChargeDetails
        ? {
            id: stripeChargeDetails.id,
            amount: stripeChargeDetails.amount / 100,
            currency: stripeChargeDetails.currency,
            status: stripeChargeDetails.status,
            paymentMethod:
              stripeChargeDetails.payment_method_details?.card?.brand,
            last4: stripeChargeDetails.payment_method_details?.card?.last4,
            receiptUrl: stripeChargeDetails.receipt_url,
            fullResponse: stripeChargeDetails,
          }
        : null,
    };
  } catch (error) {
    await transaction.rollback();
    console.error("❌ Error creating One-to-One booking:", error);
    throw error;
  }
};
