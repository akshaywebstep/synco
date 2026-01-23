
const {
    Booking,
    BookingStudentMeta,
    BookingParentMeta,
    BookingEmergencyMeta,
    BookingPayment,
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
function safeParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (err) {
        return str; // fallback: return original string if invalid JSON
    }
}

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
                    { model: BookingPayment, as: "payments" },
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
        const normalizeParent = (p) => ({
            id: p.id,
            studentId: p.studentId,
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            phoneNumber: p.phoneNumber || p.parentPhoneNumber || null,
            relationChild: p.relationChild || p.relationToChild || null,
            howDidHear: p.howDidHear || p.howDidYouHear || null,
        });
        const normalizeBookingPaymentFlat = (p) => ({
            id: p.id ?? null,
            bookingId: p.bookingId ?? null,
            firstName: p.firstName ?? null,
            lastName: p.lastName ?? null,
            email: p.email ?? null,
            billingAddress: p.billingAddress ?? null,
            cardHolderName: p.cardHolderName ?? null,
            cv2: p.cv2 ?? null,
            expiryDate: p.expiryDate ?? null,
            price: p.price ?? null,
            account_holder_name: p.account_holder_name ?? null,
            paymentType: p.paymentType ?? null,
            account_number: p.account_number ?? null,
            branch_code: p.branch_code ?? null,
            paymentStatus: p.paymentStatus ?? null,
            currency: p.currency ?? null,
            merchantRef: p.merchantRef ?? null,
            description: p.description ?? null,
            commerceType: p.commerceType ?? null,
            // ✅ Parse JSON fields if they exist
            gatewayResponse: p.gatewayResponse ? safeParseJSON(p.gatewayResponse) : null,
            transactionMeta: p.transactionMeta ? safeParseJSON(p.transactionMeta) : null,
            goCardlessCustomer: p.goCardlessCustomer ? safeParseJSON(p.goCardlessCustomer) : null,
            goCardlessBankAccount: p.goCardlessBankAccount ? safeParseJSON(p.goCardlessBankAccount) : null,
            goCardlessBillingRequest: p.goCardlessBillingRequest ? safeParseJSON(p.goCardlessBillingRequest) : null,
            createdAt: p.createdAt ?? null,
            updatedAt: p.updatedAt ?? null,
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
                    medicalInformation: s.medicalInfo || s.medicalInformation || null,
                })) || [];

            /* ---------------- Parents ---------------- */
            const parents =
                booking.students?.flatMap((s) =>
                    (s.parents || []).map((p) =>
                        normalizeParent({ ...p, studentId: s.id })
                    )
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
            /* ---------------- Payments (FIXED) ---------------- */
            const payments =
                (booking.payments || []).map(normalizeBookingPaymentFlat);
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
                payments,
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
                        medicalInformation: s.medicalInfo || null,
                    })) || [];

                const parents =
                    booking.students?.flatMap((s) =>
                        (Array.isArray(s.parentDetails)
                            ? s.parentDetails
                            : s.parentDetails ? [s.parentDetails] : []
                        ).map((p) =>
                            normalizeParent({ ...p, studentId: s.id })
                        )
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
                const normalizeOneToOnePayment = (p) => {
                    if (!p) return null;

                    return {
                        id: p.id,
                        oneToOneBookingId: p.oneToOneBookingId,
                        stripeSessionId: p.stripeSessionId,
                        stripePaymentIntentId: p.stripePaymentIntentId,
                        baseAmount: p.baseAmount,
                        discountAmount: p.discountAmount,
                        amount: p.amount,
                        currency: p.currency,
                        paymentStatus: p.paymentStatus,
                        paymentDate: p.paymentDate,
                        failureReason: p.failureReason,
                        createdAt: p.createdAt,
                        updatedAt: p.updatedAt,
                    };
                };

                // ✅ FIXED PAYMENT
                const payment = normalizeOneToOnePayment(booking.payment);
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
                        paymentPlan: booking.paymentPlan || null,
                        payment,
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
                        gender: s.gender,
                        age: s.age,
                        dateOfBirth: s.dateOfBirth,
                        medicalInformation: s.medicalInfo || null,
                    })) || [];

                const parents =
                    booking.students?.flatMap((s) =>
                        (s.parentDetails || []).map((p) =>
                            normalizeParent({ ...p, studentId: s.id })
                        )
                    ) || [];

                const emergency =
                    booking.students
                        ?.flatMap((s) => (s.emergencyDetails ? [s.emergencyDetails] : []))
                        ?.map((e) => ({
                            emergencyFirstName: e.emergencyFirstName,
                            emergencyLastName: e.emergencyLastName,
                            emergencyPhoneNumber: e.emergencyPhoneNumber,
                            emergencyRelation: e.emergencyRelation,
                        }))
                        ?.shift() || null;
                const normalizeBirthdayPartyPayment = (p) => {
                    if (!p) return null;

                    return {
                        id: p.id,
                        birthdayPartyBookingId: p.birthdayPartyBookingId,
                        stripeSessionId: p.stripeSessionId,
                        stripePaymentIntentId: p.stripePaymentIntentId,
                        baseAmount: p.baseAmount,
                        discountAmount: p.discountAmount,
                        amount: p.amount,
                        currency: p.currency,
                        paymentStatus: p.paymentStatus,
                        paymentDate: p.paymentDate,
                        failureReason: p.failureReason,
                        createdAt: p.createdAt,
                        updatedAt: p.updatedAt,
                    };
                };

                // ✅ FIXED PAYMENT
                const payment = normalizeBirthdayPartyPayment(booking.payment);

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
                        paymentPlan: booking.paymentPlan || null,
                        payment,
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
                                    { expand: ["latest_charge", "latest_charge.balance_transaction"] }
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
                        gatewayResponse: stripeChargeDetails,
                    };
                }

                return {
                    ...booking,
                    parents: Object.values(parentMap).map(p =>
                        normalizeParent(p)
                    ),
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
            normalize(p.parentEmail),
            normalize(p.phoneNumber),
            normalize(p.parentFirstName),
            normalize(p.parentLastName),
            normalize(p.relationChild),
            normalize(p.howDidHear),
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
        const weeklyBookings = formattedBookings.map(b => ({ ...b }));
        const oneToOneBookings = formattedOneToOneLead.map(l => ({
            id: l.id,
            parentAdminId,
            serviceType: "one to one",
            status: l.status,
            createdAt: l.createdAt,
            coach: l.booking?.coach || null,
            date: l.booking?.date || null,
            time: l.booking?.time || null,
            paymentPlan: l.booking?.paymentPlan || null, // ✅ FIX
            payment: l.booking?.payment || null,
            students: l.booking?.students || [],
            parents: l.booking?.parents || [],
            emergency: l.booking?.emergency || null,
        }));
        const birthdayBookings = formattedBirthdayPartyLead.map(l => ({
            id: l.id,
            parentAdminId,
            serviceType: "birthday party",
            status: l.status,
            createdAt: l.partyDate,
            coach: l.booking?.coach || null,
            partyDate: l.partyDate,
            paymentPlan: l.booking?.paymentPlan || null, // ✅ FIX
            payment: l.booking?.payment || null,
            students: l.booking?.students || [],
            parents: l.booking?.parents || [],
            emergency: l.booking?.emergency || null,
        }));
        const holidayBookingsNormalized = formattedHolidayBooking.map(b => ({
            id: b.id,
            parentAdminId,
            serviceType: "holiday camp",
            bookedBy: b.bookedBy,
            status: b.status,
            createdAt: b.createdAt,
            classSchedule: b.holidayClassSchedules || [],
            paymentPlan: b.holidayPaymentPlan || null,
            students: b.students || [],
            parents: b.parents || [],
            emergency: (b.emergencyContacts || [])[0] || null,
            payment: b.payment || null, // ✅ add this line
        }));

        const combinedBookings = [
            ...weeklyBookings,
            ...birthdayBookings,
            ...oneToOneBookings,
            ...holidayBookingsNormalized,
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return {
            status: true,
            message: "Fetched combined bookings successfully.",
            data: {
                combinedBookings,
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
