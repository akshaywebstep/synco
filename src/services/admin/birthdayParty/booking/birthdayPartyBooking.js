const { Op } = require("sequelize");
const {
    BirthdayPartyBooking,
    BirthdayPartyStudent,
    BirthdayPartyParent,
    BirthdayPartyEmergency,
    BirthdayPartyPayment,
    BirthdayPartyLead,
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
const bcrypt = require("bcrypt");

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
const sendSMS = require("../../../../utils/sms/clickSend");

const PANEL = "admin";

exports.createBirthdayPartyBooking = async (data) => {
    const transaction = await sequelize.transaction();

    try {
        // -----------------------------------------------------
        // 0️⃣ Check if Lead Already Has Booking
        // -----------------------------------------------------
        let lead = null;
        if (data.leadId) {
            lead = await BirthdayPartyLead.findByPk(data.leadId);
            if (!lead) throw new Error(`Lead ID ${data.leadId} not found`);

            const existingBooking = await BirthdayPartyBooking.findOne({
                where: { leadId: data.leadId },
            });

            if (existingBooking) {
                console.warn(
                    `⚠️ Lead ID ${data.leadId} already associated with Booking ID ${existingBooking.id}`
                );

                return {
                    success: false,
                    message: "You have already booked this lead.",
                };
            }
        }

        // Determine source from lead (default to "website")
        const source = lead?.source?.toLowerCase() || "Website";

        // -----------------------------------------------------
        // 1️⃣ Calculate Base Amount + Discount
        // -----------------------------------------------------
        let paymentPlan = null;
        let baseAmount = 0;

        if (data.paymentPlanId) {
            paymentPlan = await PaymentPlan.findByPk(data.paymentPlanId);
            if (!paymentPlan) throw new Error("Invalid payment plan ID");

            baseAmount = paymentPlan.price || 0;
        }

        let discount = null;
        let discount_amount = 0;
        let finalAmount = baseAmount;
        let parentAdminId = null;

        // -----------------------------
        // DISCOUNT LOGIC
        // -----------------------------
        if (data.discountId) {
            discount = await Discount.findByPk(data.discountId, {
                include: [{ model: DiscountAppliesTo, as: "appliesTo" }],
            });

            if (!discount) throw new Error("Invalid discount ID");

            const now = new Date();

            if (discount.startDatetime && now < new Date(discount.startDatetime))
                throw new Error(`Discount ${discount.code} is not active yet.`);

            if (discount.endDatetime && now > new Date(discount.endDatetime))
                throw new Error(`Discount ${discount.code} has expired.`);

            const targets = discount.appliesTo.map((a) => a.target);
            if (!targets.includes("birthday_party")) {
                throw new Error(
                    `Discount ${discount.code} is not valid for birthday party bookings.`
                );
            }

            if (discount.limitTotalUses !== null) {
                const usedCount = await BirthdayPartyBooking.count({
                    where: { discountId: discount.id },
                });

                if (usedCount >= discount.limitTotalUses) {
                    throw new Error(
                        `Discount ${discount.code} reached total usage limit.`
                    );
                }
            }

            if (discount.valueType === "percentage") {
                discount_amount = (baseAmount * Number(discount.value)) / 100;
            } else {
                discount_amount = Number(discount.value);
            }

            finalAmount = Math.max(baseAmount - discount_amount, 0);
        }

        // -----------------------------
        // Parent Admin Creation
        // -----------------------------
        if (data.parents?.length > 0) {
            const firstParent = data.parents[0];
            const email = firstParent.parentEmail?.trim()?.toLowerCase();
            if (!email) throw new Error("Parent email is required");

            const parentRole = await AdminRole.findOne({
                where: { role: "Parents" },
                transaction,
            });
            if (!parentRole) throw new Error("Parent role not found");

            const hashedPassword = await bcrypt.hash("Synco123", 10);

            if (source === "admin") {
                // ADMIN PORTAL → always create new parent
                const admin = await Admin.create(
                    {
                        firstName: firstParent.parentFirstName || "Parent",
                        lastName: firstParent.parentLastName || "",
                        phoneNumber: firstParent.phoneNumber || "",
                        email,
                        password: hashedPassword,
                        roleId: parentRole.id,
                        status: "active",
                    },
                    { transaction }
                );
                parentAdminId = admin.id;
            } else {
                // WEBSITE / Referral / Online / Flyer → findOrCreate
                const [admin] = await Admin.findOrCreate({
                    where: { email },
                    defaults: {
                        firstName: firstParent.parentFirstName || "Parent",
                        lastName: firstParent.parentLastName || "",
                        phoneNumber: firstParent.phoneNumber || "",
                        email,
                        password: hashedPassword,
                        roleId: parentRole.id,
                        status: "active",
                    },
                    transaction,
                });
                parentAdminId = admin.id;
            }
        }

        // -----------------------------------------------------
        // 2️⃣ Create Booking
        // -----------------------------------------------------
        const booking = await BirthdayPartyBooking.create(
            {
                leadId: data.leadId || null,
                parentAdminId,
                coachId: data.coachId,
                address: data.address,
                date: data.date,
                time: data.time,
                paymentPlanId: data.paymentPlanId || null,
                discountId: data.discountId || null,
                status: "pending",
                type: "paid",
                serviceType: "birthday party",
            },
            { transaction }
        );
        // -----------------------------------------------------
        // 2.1️⃣ Update Lead Status
        // -----------------------------------------------------
        if (data.leadId) {
            await BirthdayPartyLead.update(
                { status: "active" },
                { where: { id: data.leadId }, transaction }
            );
        }

        // -----------------------------------------------------
        // 3️⃣ Create Students, Parents, Emergency Contact
        // -----------------------------------------------------
        const students = await Promise.all(
            (data.students || []).map((s) =>
                BirthdayPartyStudent.create(
                    {
                        birthdayPartyBookingId: booking.id,
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
                        BirthdayPartyParent.create(
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
                await BirthdayPartyEmergency.create(
                    {
                        studentId: firstStudent.id,
                        emergencyFirstName: data.emergency.emergencyFirstName,
                        emergencyLastName: data.emergency.emergencyLastName,
                        emergencyPhoneNumber:
                            data.emergency.emergencyPhoneNumber,
                        emergencyRelation: data.emergency.emergencyRelation,
                    },
                    { transaction }
                );
            }
        }

        // -----------------------------------------------------
        // 4️⃣ Stripe Payment
        // -----------------------------------------------------
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
            console.error("❌ Stripe Payment Error:", err.message);
            errorMessage = err.message;
        }

        // -----------------------------------------------------
        // 5️⃣ Store Payment Record
        // -----------------------------------------------------
        await BirthdayPartyPayment.create(
            {
                birthdayPartyBookingId: booking.id,
                amount: finalAmount,
                discountAmount: discount_amount, // FIXED
                baseAmount,
                paymentStatus,
                stripePaymentIntentId: stripeChargeId,
                paymentDate: new Date(),
                failureReason: errorMessage,
            },
            { transaction }
        );

        booking.status = "pending";
        booking.type = "paid";
        await booking.save({ transaction });

        // -----------------------------------------------------
        // 6️⃣ Fetch Stripe Charge Details (optional)
        // -----------------------------------------------------
        let stripeChargeDetails = null;

        if (stripeChargeId) {
            try {
                const stripe = await stripePromise;
                stripeChargeDetails = await stripe.charges.retrieve(
                    stripeChargeId
                );
            } catch (err) {
                console.error(
                    "⚠️ Could not fetch Stripe charge details:",
                    err.message
                );
            }
        }

        // -----------------------------------------------------
        // 7️⃣ Record Discount Usage
        // -----------------------------------------------------
        if (discount && paymentStatus === "paid" && data.adminId) {
            await DiscountUsage.create(
                {
                    discountId: discount.id,
                    adminId: data.adminId,
                    usedAt: new Date(),
                },
                { transaction }
            );
        }
        if (paymentStatus === "paid") {
            booking.status = "active";
            await booking.save({ transaction });
        }

        await transaction.commit();

        // -----------------------------------------------------
        // 8️⃣ Send Confirmation Email
        // -----------------------------------------------------
        /*
        try {
            if (paymentStatus === "paid") {
                const {
                    status: configStatus,
                    emailConfig,
                    htmlTemplate,
                    subject,
                } = await emailModel.getEmailConfig(
                    PANEL,
                    "birthday-party-booking"
                );

                if (configStatus && htmlTemplate) {
                    const firstParent = data.parents?.[0];

                    if (firstParent?.parentEmail) {
                        let studentsHtml = students
                            .map(
                                (student) => `
        <tr>
          <td style="padding:5px;">
            <p style="font-weight:600;">Student Name:</p>
            <p>${student.studentFirstName || ""} ${student.studentLastName || ""
                                    }</p>
          </td>
          <td style="padding:5px;">
            <p style="font-weight:600;">Age:</p>
            <p>${student.age || ""}</p>
          </td>
          <td style="padding:5px;">
            <p style="font-weight:600;">Gender:</p>
            <p>${student.gender || ""}</p>
          </td>
        </tr>`
                            )
                            .join("");

                        let htmlBody = htmlTemplate
                            .replace(
                                /{{parentName}}/g,
                                `${firstParent.parentFirstName} ${firstParent.parentLastName}`
                            )
                            .replace(/{{address}}/g, data.address || "")
                            .replace(
                                /{{relationChild}}/g,
                                firstParent.relationChild || ""
                            )
                            .replace(
                                /{{phoneNumber}}/g,
                                firstParent.phoneNumber || ""
                            )
                            .replace(/{{className}}/g, "Birthday Party Coaching")
                            .replace(/{{classTime}}/g, data.time || "")
                            .replace(/{{startDate}}/g, data.date || "")
                            .replace(
                                /{{parentEmail}}/g,
                                firstParent.parentEmail || ""
                            )
                            .replace(/{{parentPassword}}/g, "Synco123")
                            .replace(/{{appName}}/g, "Synco")
                            .replace(
                                /{{year}}/g,
                                new Date().getFullYear().toString()
                            )
                            .replace(
                                /{{logoUrl}}/g,
                                "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
                            )
                            .replace(
                                /{{kidsPlaying}}/g,
                                "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
                            )
                            .replace(/{{studentsTable}}/g, studentsHtml);

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
                    }
                } else {
                    console.warn(
                        "⚠️ Email template config not found for 'birthday-party-booking'"
                    );
                }
            }
        } catch (emailErr) {
            console.error("❌ Email sending failed:", emailErr.message);
        }
            */
        // -----------------------------------------------------
        // 9️⃣ Return Success Response
        // -----------------------------------------------------
        return {
            success: true,
            bookingId: booking.id,
            paymentStatus,
            stripePaymentIntentId: stripeChargeId,
            baseAmount,
            discountAmount: discount_amount,
            finalAmount,
            stripeChargeDetails: stripeChargeDetails
                ? {
                    id: stripeChargeDetails.id,
                    amount: stripeChargeDetails.amount / 100,
                    currency: stripeChargeDetails.currency,
                    status: stripeChargeDetails.status,
                    paymentMethod:
                        stripeChargeDetails.payment_method_details?.card
                            ?.brand,
                    last4:
                        stripeChargeDetails.payment_method_details?.card
                            ?.last4,
                    receiptUrl: stripeChargeDetails.receipt_url,
                    fullResponse: stripeChargeDetails,
                }
                : null,
        };
    } catch (error) {
        await transaction.rollback();
        console.error("❌ Error creating birthday party booking:", error);
        throw error;
    }
};

exports.sendAllSMSToParents = async ({ bookingId }) => {
  try {
    const bookingIds = Array.isArray(bookingId) ? bookingId : [bookingId];
    const sentTo = [];

    for (const id of bookingIds) {
      // 1️⃣ Fetch booking
      const booking = await BirthdayPartyBooking.findByPk(id);
      if (!booking) {
        console.warn(`⚠️ Booking not found: ${id}`);
        continue;
      }

      // 2️⃣ Only PAID bookings
      if (booking.type !== "paid") {
        console.warn(`⚠️ Skipping booking ${id} (not paid)`);
        continue;
      }

      // 3️⃣ Only ACTIVE or CANCEL
      if (!["active", "cancel"].includes(booking.status)) {
        console.warn(`⚠️ Skipping booking ${id} (invalid status)`);
        continue;
      }

      // 4️⃣ Fetch students
      const students = await BirthdayPartyStudent.findAll({
        where: { birthdayPartyBookingId: id },
      });

      if (!students.length) {
        console.warn(`⚠️ No students for booking: ${id}`);
        continue;
      }

      // 5️⃣ Fetch first parent
      const parent = await BirthdayPartyParent.findOne({
        where: { studentId: students[0].id },
        order: [["id", "ASC"]],
      });

      if (!parent?.phoneNumber) {
        console.warn(`⚠️ No parent phone for booking: ${id}`);
        continue;
      }

      const phone = parent.phoneNumber.trim();

      // 6️⃣ Validate phone
      if (!/^\+\d{8,15}$/.test(phone)) {
        console.warn(`⚠️ Invalid phone format: ${phone}`);
        continue;
      }

      // 7️⃣ Build message
      let message = "Hello, this is Synco. ";

      if (booking.status === "active") {
        message += `Your session on ${booking.date} at ${booking.time} is confirmed.`;
      } else {
        message += `Your paid booking has been cancelled. Please contact support.`;
      }

      // 8️⃣ Send SMS
      const smsResult = await sendSMS(phone, message);

      if (smsResult?.success) {
        sentTo.push({ bookingId: id, phone });
      }

      if (DEBUG) {
        console.log("📲 SMS attempt:", {
          bookingId: id,
          phone,
          success: smsResult?.success,
        });
      }
    }

    return {
      status: true,
      message: `SMS sent for ${sentTo.length} booking(s)`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendAllSMSToParents Error:", error);
    return {
      status: false,
      message: error.message || "Unexpected error occurred",
    };
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
                        target: "birthday_party",
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