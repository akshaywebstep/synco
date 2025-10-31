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

exports.createOnetoOneBooking = async (data) => {
    const transaction = await sequelize.transaction();
    try {
        // 1️⃣ Get payment plan and base amount
        let paymentPlan = null;
        let baseAmount = 0;

        if (data.paymentPlanId) {
            paymentPlan = await PaymentPlan.findByPk(data.paymentPlanId);
            if (!paymentPlan) throw new Error("Invalid payment plan ID");
            baseAmount = paymentPlan.price || 0;
        }

        // 2️⃣ Apply discount if any
        let discount = null;
        let discountAmount = 0;
        let finalAmount = baseAmount;

        if (data.discountId) {
            discount = await Discount.findByPk(data.discountId);
            if (!discount) throw new Error("Invalid discount ID");

            // 💰 Apply discount based on type
            if (discount.value_type === "percentage") {
                discountAmount = (baseAmount * discount.value) / 100;
            } else if (discount.value_type === "fixed") {
                discountAmount = discount.value;
            }

            // 🧮 Ensure final amount doesn’t go negative
            finalAmount = Math.max(baseAmount - discountAmount, 0);
        }

        // 3️⃣ Create booking
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

        // 4️⃣ Create students
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

        // 5️⃣ Link parents & emergency to first student
        const firstStudent = students[0];
        if (firstStudent) {
            if (data.parents && data.parents.length > 0) {
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

        // 6️⃣ Process Stripe payment
        let paymentStatus = "failed";
        let stripePaymentIntentId = null;
        let errorMessage = null;

        try {
            const paymentMethod = await stripe.paymentMethods.create({
                type: "card",
                card: {
                    number: data.payment.cardNumber,
                    exp_month: data.payment.expiryMonth,
                    exp_year: data.payment.expiryYear,
                    cvc: data.payment.securityCode,
                },
                billing_details: {
                    name: `${data.payment.firstName} ${data.payment.lastName}`,
                    email: data.payment.email,
                    address: { line1: data.payment.billingAddress },
                },
            });

            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(finalAmount * 100),
                currency: "usd",
                payment_method: paymentMethod.id,
                confirm: true,
                description: `One-to-One Booking #${booking.id}`,
                metadata: {
                    bookingId: booking.id,
                    leadId: data.leadId,
                },
            });

            if (paymentIntent.status === "succeeded") {
                paymentStatus = "paid";
                stripePaymentIntentId = paymentIntent.id;
            }
        } catch (err) {
            errorMessage = err.message;
            console.error("❌ Stripe payment failed:", err);
        }

        // 7️⃣ Save payment record
        await OneToOnePayment.create(
            {
                oneToOneBookingId: booking.id,
                amount: finalAmount,
                discountAmount,
                baseAmount,
                paymentStatus,
                stripePaymentIntentId,
                paymentDate: new Date(),
                failureReason: errorMessage,
            },
            { transaction }
        );

        // 8️⃣ Update booking status
        booking.status = paymentStatus === "paid" ? "active" : "pending";
        await booking.save({ transaction });

        // ✅ Commit
        await transaction.commit();

        return {
            success: true,
            bookingId: booking.id,
            paymentStatus,
            baseAmount,
            discountAmount,
            finalAmount,
        };
    } catch (error) {
        await transaction.rollback();
        console.error("❌ Error creating One-to-One booking:", error);
        throw error;
    }
};
