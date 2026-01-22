
const {
    Booking,
    BookingStudentMeta,
    BookingParentMeta,
    BookingEmergencyMeta,
    ClassSchedule,
    Venue,
    PaymentPlan,
    OneToOneBooking,
    OneToOneStudent,
    OneToOneParent,
    OneToOneEmergency,
    OneToOnePayment,
    BirthdayPartyBooking,
    BirthdayPartyStudent,
    BirthdayPartyParent,
    BirthdayPartyEmergency,
    BirthdayPartyPayment,
    Admin,
    HolidayBooking,
    HolidayBookingStudentMeta,
    HolidayBookingParentMeta,
    HolidayBookingEmergencyMeta,
    HolidayBookingPayment,
    HolidayPaymentPlan,
    HolidayVenue,
    HolidayClassSchedule,
    HolidayCamp,
    HolidayCampDates,
    Discount,
} = require("../../../models");
const { Op } = require("sequelize");
const stripePromise = require("../../../utils/payment/pay360/stripe");
const normalize = (v) =>
    String(v || "")
        .trim()
        .toLowerCase();

const uniqueBySignature = (items, signatureFn) => {
    const map = new Map();

    items.forEach(item => {
        const signature = signatureFn(item);
        if (signature) {
            map.set(signature, item);
        }
    });

    return Array.from(map.values());
};

exports.getCombinedBookingsByParentAdminId = async (parentAdminId) => {
    try {
        // Run both queries in parallel
        const [bookings, oneToOneLead, birthdayPartyLead, holidayBookings] = await Promise.all([
            Booking.findAll({
                where: { parentAdminId },
                include: [
                    {
                        model: BookingStudentMeta,
                        as: "students",
                        required: false,
                        include: [
                            { model: BookingParentMeta, as: "parents", required: false },
                            { model: BookingEmergencyMeta, as: "emergencyContacts", required: false },
                        ],
                    },
                    {
                        model: ClassSchedule,
                        as: "classSchedule",
                        required: false,
                        include: [{ model: Venue, as: "venue", required: false }],
                    },
                ],
                order: [["createdAt", "DESC"]],
            }),

            OneToOneBooking.findAll({
                where: { parentAdminId },
                include: [
                    {
                        model: OneToOneStudent,
                        as: "students",
                        include: [
                            { model: OneToOneParent, as: "parentDetails" },
                            {
                                model: OneToOneEmergency,
                                as: "emergencyDetails",
                                attributes: [
                                    "id",
                                    "studentId",
                                    "emergencyFirstName",
                                    "emergencyLastName",
                                    "emergencyPhoneNumber",
                                    "emergencyRelation",
                                ],
                            },
                        ],
                    },
                    { model: OneToOnePayment, as: "payment" },
                    { model: PaymentPlan, as: "paymentPlan" },
                    { model: Admin, as: "coach" },
                ],
            }),

            // ✅ Birthday Party Lead
            BirthdayPartyBooking.findAll({
                where: { parentAdminId },
                include: [
                    {
                        model: BirthdayPartyStudent,
                        as: "students",
                        include: [
                            { model: BirthdayPartyParent, as: "parentDetails" },
                            {
                                model: BirthdayPartyEmergency,
                                as: "emergencyDetails",
                                attributes: [
                                    "id",
                                    "studentId",
                                    "emergencyFirstName",
                                    "emergencyLastName",
                                    "emergencyPhoneNumber",
                                    "emergencyRelation",
                                ],
                            },
                        ],
                    },
                    { model: BirthdayPartyPayment, as: "payment" },
                    { model: PaymentPlan, as: "paymentPlan" },
                    { model: Admin, as: "coach" },
                ],
            }),

            // Holiday Booking
            HolidayBooking.findAll({
                where: { parentAdminId },
                include: [
                    {
                        model: HolidayBookingStudentMeta,
                        as: "students",
                        include: [
                            { model: HolidayBookingParentMeta, as: "parents" },
                            { model: HolidayBookingEmergencyMeta, as: "emergencyContacts" },
                        ],
                    },
                    { model: HolidayBookingPayment, as: "payment" },
                    { model: HolidayPaymentPlan, as: "holidayPaymentPlan" },
                    { model: HolidayVenue, as: "holidayVenue" },
                    {
                        model: HolidayClassSchedule,
                        as: "holidayClassSchedules",
                        include: [{ model: HolidayVenue, as: "venue" }],
                    },
                    { model: Discount, as: "discount" },
                    {
                        model: Admin,
                        as: "bookedByAdmin",
                        attributes: ["id", "firstName", "lastName"],
                    },
                    {
                        model: HolidayCamp,
                        as: "holidayCamp",
                        include: [{ model: HolidayCampDates, as: "holidayCampDates" }],
                    },
                ],
            }),
        ]);

        // Process bookings payment plans
        const paymentPlanIds = bookings.map((b) => b.paymentPlanId).filter(Boolean);

        let paymentPlans = [];
        if (paymentPlanIds.length) {
            paymentPlans = await PaymentPlan.findAll({
                where: { id: { [Op.in]: paymentPlanIds } },
            });
        }
        const paymentPlanMap = {};
        paymentPlans.forEach((plan) => {
            paymentPlanMap[plan.id] = plan;
        });

        // Format bookings with paymentPlan attached
        const formattedBookings = bookings.map((bookingInstance) => {
            const booking = bookingInstance.get({ plain: true });

            /* ---------------- Students ---------------- */
            const students =
                booking.students?.map((s) => ({
                    id: s.id,
                    studentFirstName: s.studentFirstName,
                    studentLastName: s.studentLastName,
                    dateOfBirth: s.dateOfBirth,
                    age: s.age,
                    gender: s.gender,
                    medicalInfo: s.medicalInfo,
                })) || [];

            /* ---------------- Parents ---------------- */
            const parents =
                booking.students?.flatMap((s) =>
                    (s.parents || []).map((p) => ({
                        id: p.id,
                        studentId: s.id,
                        parentFirstName: p.parentFirstName,
                        parentLastName: p.parentLastName,
                        parentEmail: p.parentEmail,
                        phoneNumber: p.phoneNumber,
                        relationChild: p.relationChild,
                        howDidHear: p.howDidHear,
                    }))
                ) || [];

            /* ---------------- Emergency ---------------- */
            const emergency =
                booking.students
                    ?.flatMap((s) =>
                        (s.emergencyContacts || []).map((e) => ({
                            id: e.id,
                            emergencyFirstName: e.emergencyFirstName,
                            emergencyLastName: e.emergencyLastName,
                            emergencyPhoneNumber: e.emergencyPhoneNumber,
                            emergencyRelation: e.emergencyRelation,
                        }))
                    )
                    ?.shift() || null;

            return {
                id: booking.id,
                parentAdminId: booking.parentAdminId,
                serviceType: booking.serviceType,
                status: booking.status,
                createdAt: booking.createdAt,

                classSchedule: booking.classSchedule || null,

                paymentPlan: booking.paymentPlanId
                    ? paymentPlanMap[booking.paymentPlanId] || null
                    : null,

                students,
                parents,
                emergency,
            };
        });

        // Format one-to-one lead if exists (reuse your existing formatting logic)
        const formattedOneToOneLead =
            (oneToOneLead || []).map((leadInstance) => {
                const leadPlain = leadInstance.get({ plain: true });
                const booking = leadPlain;

                const students =
                    booking.students?.map((s) => ({
                        id: s.id,
                        studentFirstName: s.studentFirstName,
                        studentLastName: s.studentLastName,
                        dateOfBirth: s.dateOfBirth,
                        age: s.age,
                        gender: s.gender,
                        medicalInfo: s.medicalInfo,
                    })) || [];

                const parents =
                    booking.students?.flatMap((s) =>
                        (Array.isArray(s.parentDetails)
                            ? s.parentDetails
                            : s.parentDetails
                                ? [s.parentDetails]
                                : []
                        ).map((p) => ({
                            id: p.id,
                            studentId: s.id,
                            parentFirstName: p.parentFirstName,
                            parentLastName: p.parentLastName,
                            parentEmail: p.parentEmail,
                            phoneNumber: p.phoneNumber,
                            relationChild: p.relationChild,
                            howDidHear: p.howDidHear,
                        }))
                    ) || [];

                const emergency =
                    booking.students
                        ?.flatMap((s) =>
                            (Array.isArray(s.emergencyDetails)
                                ? s.emergencyDetails
                                : s.emergencyDetails
                                    ? [s.emergencyDetails]
                                    : []
                            ).map((e) => ({
                                emergencyFirstName: e.emergencyFirstName,
                                emergencyLastName: e.emergencyLastName,
                                emergencyPhoneNumber: e.emergencyPhoneNumber,
                                emergencyRelation: e.emergencyRelation,
                            }))
                        )
                        ?.shift() || null;

                return {
                    id: leadPlain.id,
                    parentName: leadPlain.parentName,
                    childName: leadPlain.childName,
                    age: leadPlain.age,
                    source: leadPlain.source,
                    status: leadPlain.status,
                    createdAt: leadPlain.createdAt,
                    booking: {
                        id: booking.id,
                        coach: booking.coach,
                        date: booking.date,
                        time: booking.time,
                        students,
                        parents,
                        emergency,
                    },
                };
            });

        // Format Birthday party
        const formattedBirthdayPartyLead =
            (birthdayPartyLead || []).map((leadInstance) => {
                const leadPlain = leadInstance.get({ plain: true });
                const booking = leadPlain;

                const students =
                    booking.students?.map((s) => ({
                        id: s.id,
                        studentFirstName: s.studentFirstName,
                        studentLastName: s.studentLastName,
                        age: s.age,
                    })) || [];

                const parents =
                    booking.students?.flatMap((s) =>
                        (s.parentDetails || []).map((p) => ({
                            id: p.id,
                            studentId: s.id,
                            parentFirstName: p.parentFirstName,
                            parentLastName: p.parentLastName,
                            parentEmail: p.parentEmail,
                            phoneNumber: p.phoneNumber,
                        }))
                    ) || [];

                const emergency =
                    booking.students
                        ?.flatMap((s) => (s.emergencyDetails ? [s.emergencyDetails] : []))
                        ?.map((e) => ({
                            emergencyFirstName: e.emergencyFirstName,
                            emergencyPhoneNumber: e.emergencyPhoneNumber,
                        }))
                        ?.shift() || null;

                return {
                    id: leadPlain.id,
                    parentName: leadPlain.parentName,
                    partyDate: leadPlain.partyDate,
                    status: leadPlain.status,
                    booking: {
                        id: booking.id,
                        coach: booking.coach,
                        students,
                        parents,
                        emergency,
                    },
                };
            });

        // Format holiday bookings (multiple)
        const formattedHolidayBooking = await Promise.all(
            (holidayBookings || []).map(async (bookingInstance) => {
                const booking = bookingInstance.get({ plain: true });

                // Parents map and remove from students
                const parentMap = {};
                booking.students?.forEach((st) => {
                    (st.parents || []).forEach((p) => (parentMap[p.id] = p));
                    delete st.parents;
                });

                // Emergency contacts map and remove from students
                const emergencyMap = {};
                booking.students?.forEach((st) => {
                    (st.emergencyContacts || []).forEach((e) => (emergencyMap[e.id] = e));
                    delete st.emergencyContacts;
                });

                // Payment and Stripe details
                let paymentObj = null;

                if (booking.payment) {
                    const stripeChargeId = booking.payment.stripe_payment_intent_id;
                    let stripeChargeDetails = null;

                    if (stripeChargeId) {
                        try {
                            const stripe = await stripePromise;

                            if (stripeChargeId.startsWith("pi_")) {
                                const pi = await stripe.paymentIntents.retrieve(
                                    stripeChargeId,
                                    {
                                        expand: ["latest_charge", "latest_charge.balance_transaction"],
                                    }
                                );
                                stripeChargeDetails = pi.latest_charge || null;
                            } else if (stripeChargeId.startsWith("ch_")) {
                                stripeChargeDetails = await stripe.charges.retrieve(
                                    stripeChargeId,
                                    { expand: ["balance_transaction"] }
                                );
                            }
                        } catch (err) {
                            console.error("⚠️ Holiday Stripe error:", err.message);
                        }
                    }

                    paymentObj = {
                        base_amount: booking.payment.base_amount,
                        discount_amount: booking.payment.discount_amount,
                        amount: booking.payment.amount,
                        currency: booking.payment.currency,
                        payment_status: booking.payment.payment_status,
                        payment_date: booking.payment.payment_date,
                        failure_reason: booking.payment.failure_reason,
                        email: booking.payment.email,
                        billingAddress: booking.payment.billingAddress,
                        gatewayResponse: stripeChargeDetails
                            ? {
                                id: stripeChargeDetails.id,
                                amount: stripeChargeDetails.amount / 100,
                                currency: stripeChargeDetails.currency,
                                status: stripeChargeDetails.status,
                                paymentMethod:
                                    stripeChargeDetails.payment_method_details?.card?.brand || null,
                                last4:
                                    stripeChargeDetails.payment_method_details?.card?.last4 || null,
                                receiptUrl: stripeChargeDetails.receipt_url || null,
                                fullResponse: stripeChargeDetails,
                            }
                            : null,
                    };
                }

                return {
                    ...booking,
                    parents: Object.values(parentMap),
                    emergencyContacts: Object.values(emergencyMap),
                    payment: paymentObj,
                };
            })
        );
        const profile = await Admin.findOne({
            where: { id: parentAdminId },
            attributes: ['id', 'firstName', 'lastName', 'email', 'roleId'],
        });
        /* ---------- STUDENT SIGNATURE ---------- */
        const studentSignature = (s) => [
            normalize(s.studentFirstName),
            normalize(s.studentLastName),
            normalize(s.dateOfBirth),
            normalize(s.gender),
        ].join("|");

        /* ---------- PARENT SIGNATURE ---------- */
        const parentSignature = (p) => [
            normalize(p.parentEmail || p.email),
            normalize(p.phoneNumber),
            normalize(p.parentFirstName),
            normalize(p.parentLastName),
        ].join("|");

        /* ---------- EMERGENCY SIGNATURE ---------- */
        const emergencySignature = (e) => [
            normalize(e.emergencyPhoneNumber),
            normalize(e.emergencyFirstName),
        ].join("|");

        let allStudents = [];
        let allParents = [];
        let allEmergency = [];

        /* Weekly */
        formattedBookings.forEach(b => {
            allStudents.push(...(b.students || []));
            allParents.push(...(b.parents || []));
            if (b.emergency) allEmergency.push(b.emergency);
        });

        /* One to One */
        formattedOneToOneLead.forEach(l => {
            allStudents.push(...(l.booking?.students || []));
            allParents.push(...(l.booking?.parents || []));
            if (l.booking?.emergency) allEmergency.push(l.booking.emergency);
        });

        /* Birthday */
        formattedBirthdayPartyLead.forEach(l => {
            allStudents.push(...(l.booking?.students || []));
            allParents.push(...(l.booking?.parents || []));
            if (l.booking?.emergency) allEmergency.push(l.booking.emergency);
        });

        /* Holiday */
        formattedHolidayBooking.forEach(b => {
            allStudents.push(...(b.students || []));
            allParents.push(...(b.parents || []));
            allEmergency.push(...(b.emergencyContacts || []));
        });

        const uniqueStudents = uniqueBySignature(allStudents, studentSignature);
        const uniqueParents = uniqueBySignature(allParents, parentSignature);
        const uniqueEmergencyContacts = uniqueBySignature(allEmergency, emergencySignature);
        return {
            status: true,
            message: "Fetched combined bookings successfully.",
            data: {
                weeklyBookings: formattedBookings,
                oneToOneLead: formattedOneToOneLead,
                birthdayPartyLead: formattedBirthdayPartyLead,
                holidayBooking: formattedHolidayBooking, // ✅ NEW
                profile,  // single admin object for the parentAdminId
                uniqueProfiles: {
                    students: uniqueStudents,
                    parents: uniqueParents,
                    emergencyContacts: uniqueEmergencyContacts,
                },
            },
        };
    } catch (error) {
        console.error("❌ getCombinedBookingsByParentAdminId Error:", error);
        return {
            status: false,
            message: error.message,
        };
    }
};
