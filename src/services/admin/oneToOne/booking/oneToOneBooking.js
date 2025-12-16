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
  DiscountUsage,
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
    // 0️⃣ Check if lead already booked
    if (data.leadId) {
      const existingBooking = await OneToOneBooking.findOne({
        where: { leadId: data.leadId },
      });

      if (existingBooking) {
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
    let discount_amount = 0;
    let finalAmount = baseAmount;

    // ==================================================
    //  DISCOUNT LOGIC (CLEANED & FIXED)
    // ==================================================
    if (data.discountId) {
      discount = await Discount.findByPk(data.discountId, {
        include: [{ model: DiscountAppliesTo, as: "appliesTo" }]
      });
      if (!discount) throw new Error("Invalid discount ID");

      const now = new Date();

      // Validate date
      if (discount.startDatetime && now < new Date(discount.startDatetime))
        throw new Error(`Discount ${discount.code} is not active yet.`);

      if (discount.endDatetime && now > new Date(discount.endDatetime))
        throw new Error(`Discount ${discount.code} has expired.`);

      // Validate applies-to
      const targets = discount.appliesTo.map(a => a.target);
      if (!targets.includes("one_to_one")) {
        throw new Error(`Discount ${discount.code} is not valid for one-to-one bookings.`);
      }

      // Validate total uses
      if (discount.limitTotalUses !== null) {
        const totalUsed = await OneToOneBooking.count({
          where: { discountId: discount.id }
        });

        if (totalUsed >= discount.limitTotalUses) {
          throw new Error(`Discount ${discount.code} reached total usage limit.`);
        }
      }

      // Apply discount
      if (discount.valueType === "percentage") {
        discount_amount = (baseAmount * Number(discount.value)) / 100;
      } else {
        discount_amount = Number(discount.value);
      }

      finalAmount = Math.max(baseAmount - discount_amount, 0);
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
            emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
            emergencyRelation: data.emergency.emergencyRelation,
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

      if (!customerId) {
        const customerRes = await createCustomer({
          body: {
            name: `${data.payment.firstName} ${data.payment.lastName}`,
            email: data.payment.email,
          },
        });
        customerId = customerRes.customer_id;
      }

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
      errorMessage = err.message;
    }

    // 5️⃣ Record payment
    await OneToOnePayment.create(
      {
        oneToOneBookingId: booking.id,
        amount: finalAmount,
        discountAmount: discount_amount,
        baseAmount,
        paymentStatus,
        stripePaymentIntentId: stripeChargeId,
        paymentDate: new Date(),
        failureReason: errorMessage,
      },
      { transaction }
    );

    // ⭐ RECORD DISCOUNT USAGE (before commit)
    if (discount && paymentStatus === "paid" && data.adminId) {
      await DiscountUsage.create(
        {
          discountId: discount.id,
          adminId: data.adminId,
          usedAt: new Date()
        },
        { transaction }
      );
    }

    await transaction.commit();

    return {
      success: true,
      bookingId: booking.id,
      paymentStatus,
      stripePaymentIntentId: stripeChargeId,
      baseAmount,
      discountAmount: discount_amount,
      finalAmount
    };

  } catch (error) {
    await transaction.rollback();
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
    const now = new Date();

    const discounts = await Discount.findAll({
      where: {
        startDatetime: {
          [Op.lte]: now, // started already
        },
        [Op.or]: [
          { endDatetime: { [Op.gte]: now } }, // not expired
          { endDatetime: null },               // no expiry
        ],
      },
      include: [
        {
          model: DiscountAppliesTo,
          as: "appliesTo",
          attributes: ["id", "target"],
          where: {
            target: "one_to_one",
          },
          required: true, // INNER JOIN
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
