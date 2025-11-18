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

const stripePromise = require("../../../../utils/payment/pay360/stripe");
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

    // 1️⃣ Load payment plan
    let paymentPlan = null;
    let baseAmount = 0;

    if (data.paymentPlanId) {
      paymentPlan = await PaymentPlan.findByPk(data.paymentPlanId);
      if (!paymentPlan) throw new Error("Invalid payment plan ID");

      baseAmount = Number(paymentPlan.price || 0);
    }

    let discount = null;
    let discountAmount = 0;
    let finalAmount = baseAmount;

    if (data.discountId) {
      discount = await Discount.findByPk(data.discountId);
      if (!discount) throw new Error("Invalid discount ID");

      const now = new Date();

      // -----------------------------
      // 1️⃣ VALIDATE DATE RANGE
      // -----------------------------
      if (discount.start_datetime && now < new Date(discount.start_datetime)) {
        throw new Error(`Discount code ${discount.code} is not active yet.`);
      }

      if (discount.end_datetime && now > new Date(discount.end_datetime)) {
        throw new Error(`Discount code ${discount.code} has expired.`);
      }

      // -----------------------------
      // 2️⃣ CHECK TOTAL USE LIMIT
      // -----------------------------
      if (discount.limit_total_uses !== null) {
        const totalUsed = await OneToOneBooking.count({
          where: { discountId: discount.id },
        });

        if (totalUsed >= discount.limit_total_uses) {
          throw new Error(
            `Discount code ${discount.code} has reached its total usage limit.`
          );
        }
      }

      // -----------------------------
      // 3️⃣ LIMIT PER STUDENT
      // -----------------------------
      if (discount.limit_per_customer !== null) {
        const firstStudent = data.students?.[0];

        if (firstStudent) {
          const studentUses = await OneToOneBooking.count({
            include: [
              {
                model: OneToOneStudent,
                as: "students",
                required: true,
                where: {
                  studentFirstName: firstStudent.studentFirstName,
                  studentLastName: firstStudent.studentLastName,
                  dateOfBirth: firstStudent.dateOfBirth,
                },
              },
            ],
            where: { discountId: discount.id },
          });

          if (studentUses >= discount.limit_per_customer) {
            throw new Error(
              `Discount code ${discount.code} already used maximum times by this student.`
            );
          }
        }
      }

      // -----------------------------
      // 4️⃣ USE DISCOUNT VALUE AS FINAL PRICE
      // -----------------------------
      finalAmount = Number(discount.value);   // 🔥 final price = discount.value

      // also store discountAmount for record (optional)
      discountAmount = baseAmount - finalAmount;
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
        serviceType: "one to one",
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
            expiryDate: data.payment.expiryDate,
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
        // ✅ Wait for Stripe to be ready
        const stripe = await stripePromise;
        stripeChargeDetails = await stripe.charges.retrieve(stripeChargeId);
      } catch (err) {
        console.error("⚠️ Failed to fetch charge details:", err.message);
      }
    }
    await transaction.commit();

    try {
      if (paymentStatus === "paid") {
        const { status: configStatus, emailConfig, htmlTemplate, subject } =
          await emailModel.getEmailConfig(PANEL, "one-to-one-booking");

        if (configStatus && htmlTemplate) {
          const firstParent = data.parents?.[0];

          if (firstParent && firstParent.parentEmail) {
            // Build HTML for all students
            let studentsHtml = students.map(student => `
          <tr>
            <td style="padding:5px; vertical-align:top;">
              <p style="margin:0; font-size:13px; color:#34353B; font-weight:600;">Student Name:</p>
              <p style="margin:0; font-size:13px; color:#5F5F6D;">${student.studentFirstName || ""} ${student.studentLastName || ""}</p>
            </td>
            <td style="padding:5px; vertical-align:top;">
              <p style="margin:0; font-size:13px; color:#34353B; font-weight:600;">Age:</p>
              <p style="margin:0; font-size:13px; color:#5F5F6D;">${student.age || ""}</p>
            </td>
            <td style="padding:5px; vertical-align:top;">
              <p style="margin:0; font-size:13px; color:#34353B; font-weight:600;">Gender:</p>
              <p style="margin:0; font-size:13px; color:#5F5F6D;">${student.gender || ""}</p>
            </td>
          </tr>
        `).join("");

            // Replace placeholders in template
            let htmlBody = htmlTemplate
              .replace(/{{parentName}}/g, `${firstParent.parentFirstName} ${firstParent.parentLastName}`)
              .replace(/{{parentEmail}}/g, firstParent.parentEmail || "")
              .replace(/{{phoneNumber}}/g, firstParent.phoneNumber || "")
              .replace(/{{relationChild}}/g, firstParent.relationChild || "")
              .replace(/{{className}}/g, "One to One Coaching")
              .replace(/{{classTime}}/g, data.time || "")
              .replace(/{{location}}/g, data.location || "")
              .replace(/{{startDate}}/g, data.date || "")
              .replace(/{{year}}/g, new Date().getFullYear().toString())
              .replace(/{{logoUrl}}/g, "https://webstepdev.com/demo/syncoUploads/syncoLogo.png")
              .replace(/{{kidsPlaying}}/g, "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png")
              .replace("{{studentsTable}}", studentsHtml);

            // ✅ Correct way: pass recipients as 'recipient' (not 'to')
            await sendEmail(emailConfig, {
              recipient: [
                {
                  name: `${firstParent.parentFirstName} ${firstParent.parentLastName}`,
                  email: firstParent.parentEmail
                }
              ],
              cc: emailConfig.cc || [],
              bcc: emailConfig.bcc || [],
              subject,
              htmlBody
            });

            console.log(`📧 Confirmation email sent to ${firstParent.parentEmail}`);
          } else {
            console.warn("⚠️ No parent email found for sending booking confirmation");
          }
        } else {
          console.warn("⚠️ Email template config not found for 'one-to-one-booking'");
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
  adminId = null, // 👈 added to handle both super admin & admin views
}) => {
  try {
    // ✅ 1️⃣ Determine target admin IDs based on who is logged in
    let adminIds = [];

    if (superAdminId && adminId && superAdminId === adminId) {
      // 🟢 Super Admin → include self + all admins under them
      const managedAdmins = await Admin.findAll({
        where: { superAdminId: Number(superAdminId), deletedAt: null },
        attributes: ["id"],
      });
      adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(Number(superAdminId));
    } else if (superAdminId && adminId) {
      // 🟢 Admin → include self + their super admin
      adminIds = [Number(adminId), Number(superAdminId)];
    } else if (superAdminId) {
      // 🟢 If only super admin provided
      adminIds = [Number(superAdminId)];
    } else if (adminId) {
      // 🟢 Fallback: only the admin’s data
      adminIds = [Number(adminId)];
    } else {
      return { status: false, message: "Invalid admin or super admin ID." };
    }

    // ✅ 2️⃣ Fetch admins based on resolved admin IDs
    const admins = await Admin.findAll({
      where: {
        id: { [Op.in]: adminIds },
        deletedAt: null,
      },
      attributes: ["id", "firstName", "lastName", "email", "roleId"],
      order: [["id", "ASC"]],
    });

    // ✅ 3️⃣ Optionally include the super admin if requested
    if (includeSuperAdmin && superAdminId && !adminIds.includes(Number(superAdminId))) {
      const superAdmin = await Admin.findByPk(superAdminId, {
        attributes: ["id", "firstName", "lastName", "email", "roleId"],
      });
      if (superAdmin) admins.unshift(superAdmin);
    }

    // ✅ 4️⃣ Fetch payment groups created by these admins
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

    // ✅ 5️⃣ Filter to show only valid admin-owned groups
    const filteredGroups = paymentGroups.filter((group) =>
      adminIds.includes(group.createdBy)
    );

    // ✅ 6️⃣ Map groups by admin (keep same structure)
    const groupedByAdmin = filteredGroups.map((group) => {
      const admin = admins.find((a) => a.id === group.createdBy);
      return {
        adminId: admin?.id || null,
        adminName: `${admin?.firstName || ""} ${admin?.lastName || ""}`.trim(),
        paymentPlans: group.paymentPlans || [],
      };
    });

    // ✅ 7️⃣ Get all discounts + appliesTo (unchanged)
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

    // ✅ 8️⃣ Return unified response (keys preserved)
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
