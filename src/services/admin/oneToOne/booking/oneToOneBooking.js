const { Op } = require("sequelize");
const {
  OneToOneBooking,
  OneToOneStudent,
  OneToOneParent,
  OneToOneEmergency,
  OneToOnePayment,
  PaymentPlan,
  PaymentGroup,
  Discount,
  DiscountAppliesTo,
  PaymentGroupHasPlan,
  Admin,
  AdminRole,
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
const sendEmail = require("../../../../utils/email/sendEmail");
const { getEmailConfig } = require("../../../email");
const emailModel = require("../../../../services/email");
const PANEL = "admin";

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
        type: "paid",
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
    (booking.type = "paid"), await booking.save({ transaction });
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

    // ✅ Send confirmation email to first parent (only if payment succeeded)
    try {
      if (paymentStatus === "paid") {
        const {
          status: configStatus,
          emailConfig,
          htmlTemplate,
          subject,
        } = await emailModel.getEmailConfig(PANEL, "one-to-one-booking"); // from your DB

        if (configStatus && htmlTemplate) {
          const firstStudent = students?.[0];
          const firstParent = data.parents?.[0];

          if (firstStudent && firstParent?.parentEmail) {
            // Build HTML email body using booking data
            let htmlBody = htmlTemplate
              .replace(
                /{{parentName}}/g,
                `${firstParent.parentFirstName} ${firstParent.parentLastName}`
              )
              .replace(
                /{{studentFirstName}}/g,
                firstStudent.studentFirstName || ""
              )
              .replace(
                /{{studentLastName}}/g,
                firstStudent.studentLastName || ""
              )
              .replace(
                /{{studentName}}/g,
                `${firstStudent.studentFirstName || ""} ${
                  firstStudent.studentLastName || ""
                }`
              )
              .replace(/{{location}}/g, data.location || "")
              .replace(/{{age}}/g, data.age || "")
              .replace(/{{gender}}/g, data.gender || "")
              .replace(/{{relationChild}}/g, data.relationChild || "")
              .replace(/{{phoneNumber}}/g, data.phoneNumber || "")
              .replace(/{{className}}/g, "One to One Coaching")
              .replace(/{{classTime}}/g, data.time || "")
              .replace(/{{startDate}}/g, data.date || "")
              .replace(/{{parentEmail}}/g, firstParent.parentEmail || "")
              .replace(/{{parentPassword}}/g, "Synco123")
              .replace(/{{appName}}/g, "Synco")
              .replace(/{{year}}/g, new Date().getFullYear().toString())
              .replace(
                /{{logoUrl}}/g,
                "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
              )
              .replace(
                /{{kidsPlaying}}/g,
                "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
              );

            await sendEmail(emailConfig, {
              recipient: [
                {
                  name: `${firstParent.parentFirstName} ${firstParent.parentLastName}`,
                  email: firstParent.parentEmail,
                },
              ],
              subject,
              htmlBody,
            });

            console.log(
              `📧 Confirmation email sent to ${firstParent.parentEmail}`
            );
          } else {
            console.warn(
              "⚠️ No parent email found for sending booking confirmation"
            );
          }
        } else {
          console.warn(
            "⚠️ Email template config not found for 'book-paid-trial'"
          );
        }
      } else {
        console.log("ℹ️ Payment not successful — skipping email send.");
      }
    } catch (emailErr) {
      console.error("❌ Error sending email to parent:", emailErr.message);
    }
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

exports.getAdminsPaymentPlanDiscount = async ({
  superAdminId,
  includeSuperAdmin = false,
}) => {
  try {
    // ✅ 1. Fetch admins under this super admin
    const admins = await Admin.findAll({
      where: {
        superAdminId: Number(superAdminId),
        deletedAt: null,
      },
      attributes: ["id", "firstName", "lastName", "email", "roleId"],
      order: [["id", "ASC"]],
    });

    // ✅ 2. Optionally include the super admin
    if (includeSuperAdmin) {
      const superAdmin = await Admin.findByPk(superAdminId, {
        attributes: ["id", "firstName", "lastName", "email", "roleId"],
      });
      if (superAdmin) admins.unshift(superAdmin);
    }

    const adminIds = admins.map((a) => a.id);

    // ✅ 3. Get payment groups created by these admins (or super admin)
    const paymentGroups = await PaymentGroup.findAll({
      where: {
        createdBy: { [Op.in]: adminIds },
        deletedAt: null,
      },
      attributes: [
        "id",
        "name",
        "createdBy",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "deletedBy",
      ],
      include: [
        {
          model: PaymentPlan,
          as: "paymentPlans",
          required: false,
          where: { deletedAt: null },
          through: {
            model: PaymentGroupHasPlan,
            attributes: [
              "id",
              "payment_plan_id",
              "payment_group_id",
              "createdBy",
              "deletedAt",
              "deletedBy",
              "createdAt",
              "updatedAt",
            ],
          },
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // ✅ 4. Filter to show only groups that belong to valid admins
    const filteredGroups = paymentGroups.filter((group) =>
      adminIds.includes(group.createdBy)
    );

    // ✅ 5. Map groups by admin
    const groupedByAdmin = filteredGroups.map((group) => {
      const admin = admins.find((a) => a.id === group.createdBy);
      return {
        adminId: admin?.id || null,
        adminName: `${admin?.firstName || ""} ${admin?.lastName || ""}`.trim(),
        paymentPlans: group.paymentPlans || [],
      };
    });

    // ✅ 6. Get all discounts + appliesTo
    const discounts = await Discount.findAll({
      include: [
        {
          model: DiscountAppliesTo,
          as: "appliesTo",
          attributes: ["id", "target"],
          required: false,
        },
      ],
      attributes: [
        "id",
        "type",
        "code",
        "valueType",
        "value",
        "applyOncePerOrder",
        "limitTotalUses",
        "limitPerCustomer",
        "startDatetime",
        "endDatetime",
        "createdAt",
        "updatedAt",
      ],
      order: [["createdAt", "DESC"]],
    });

    // ✅ 7. Return unified response
    return {
      status: true,
      message: "Admins, payment plans, and discounts fetched successfully.",
      data: {
        admins,
        paymentGroups: groupedByAdmin,
        discounts,
      },
    };
  } catch (error) {
    console.error("❌ Error in getAdminsPaymentPlanDiscount:", error);
    return {
      status: false,
      message:
        error.message || "Failed to fetch admin payment plan discount data.",
    };
  }
};
