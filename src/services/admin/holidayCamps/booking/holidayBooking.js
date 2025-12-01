const { Op } = require("sequelize");
const {
    HolidayBooking,
    HolidayBookingStudentMeta,
    HolidayBookingParentMeta,
    HolidayBookingEmergencyMeta,
    HolidayBookingPayment,
    HolidayPaymentPlan,
    HolidayPaymentGroup,
    HolidayVenue,
    HolidayClassSchedule,
    HolidayCamp,
    HolidayCampDates,
    Discount,
    Admin,
} = require("../../../../models");
const { sequelize } = require("../../../../models");
const { getEmailConfig } = require("../../../email");
const stripePromise = require("../../../../utils/payment/pay360/stripe");
const {
    createCustomer,
    createCardToken,
    addNewCard,
    createCharges,
    getStripePaymentDetails,
} = require("../../../../controllers/test/payment/stripe/stripeController");
const sendEmail = require("../../../../utils/email/sendEmail");
const emailModel = require("../../../../services/email");
const PANEL = "admin";

exports.createHolidayBooking = async (data, adminId) => {
    const transaction = await sequelize.transaction();
    try {
        // 1️⃣ Load payment plan
        let paymentPlan = null;
        let base_amount = 0;

        if (data.paymentPlanId) {
            paymentPlan = await HolidayPaymentPlan.findByPk(data.paymentPlanId);
            if (!paymentPlan) throw new Error("Invalid payment plan ID");

            base_amount = Number(paymentPlan.price || 0);
        }

        let discount = null;
        let discount_amount = 0;
        let finalAmount = base_amount;

        // ==================================================
        //  DISCOUNT LOGIC (FULLY UPDATED)
        // ==================================================
        if (data.discountId) {
            discount = await Discount.findByPk(data.discountId);
            if (!discount) throw new Error("Invalid discount ID");

            const now = new Date();

            // 1️⃣ Validate active date range ------------------
            if (discount.startDatetime && now < new Date(discount.startDatetime)) {
                throw new Error(`Discount code ${discount.code} is not active yet.`);
            }

            if (discount.endDatetime && now > new Date(discount.endDatetime)) {
                throw new Error(`Discount code ${discount.code} has expired.`);
            }

            // 2️⃣ Check total usage limit ---------------------
            if (discount.limitTotalUses !== null) {
                const totalUsed = await HolidayBooking.count({
                    where: { discountId: discount.id },
                });

                if (totalUsed >= discount.limitTotalUses) {
                    throw new Error(
                        `Discount code ${discount.code} has reached its total usage limit.`
                    );
                }
            }

            // 3️⃣ Check per-customer limit ---------------------
            if (discount.limitPerCustomer !== null) {
                const firstStudent = data.students?.[0];

                if (firstStudent) {
                    const studentUses = await HolidayBooking.count({
                        include: [
                            {
                                model: HolidayBookingStudentMeta,
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

                    if (studentUses >= discount.limitPerCustomer) {
                        throw new Error(
                            `Discount code ${discount.code} already used maximum times by this student.`
                        );
                    }
                }
            }

            // 4️⃣ APPLY DISCOUNT VALUE CORRECTLY -------------
            if (discount.valueType === "percentage") {
                discount_amount = (base_amount * Number(discount.value)) / 100;
            } else {
                discount_amount = Number(discount.value);
            }

            finalAmount = Math.max(base_amount - discount_amount, 0);
        }

        // ==================================================
        //  CREATE BOOKING
        // ==================================================
        const booking = await HolidayBooking.create(
            {
                venueId: data.venueId,
                classScheduleId: data.classScheduleId,
                holidayCampId: data.holidayCampId,
                discountId: data.discountId,
                totalStudents: data.totalStudents,
                paymentPlanId: data.paymentPlanId,
                status: "active",
                bookedBy: adminId,
                type: "paid",
                serviceType: "holiday camp",
            },
            { transaction }
        );

        // Create Students
        const students = await Promise.all(
            (data.students || []).map((s) =>
                HolidayBookingStudentMeta.create(
                    {
                        bookingId: booking.id,
                        studentFirstName: s.studentFirstName,
                        studentLastName: s.studentLastName,
                        dateOfBirth: s.dateOfBirth,
                        age: s.age,
                        gender: s.gender,
                        medicalInformation: s.medicalInformation,
                    },
                    { transaction }
                )
            )
        );

        const firstStudent = students[0];

        if (firstStudent) {
            // Parent Meta
            if (data.parents?.length) {
                await Promise.all(
                    data.parents.map((p) =>
                        HolidayBookingParentMeta.create(
                            {
                                studentId: firstStudent.id,
                                parentFirstName: p.parentFirstName,
                                parentLastName: p.parentLastName,
                                parentEmail: p.parentEmail,
                                parentPhoneNumber: p.parentPhoneNumber,
                                relationToChild: p.relationToChild,
                                howDidYouHear: p.howDidYouHear,
                            },
                            { transaction }
                        )
                    )
                );
            }

            // Emergency Meta
            if (data.emergency) {
                await HolidayBookingEmergencyMeta.create(
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

        // ==================================================
        //  FETCH CLASS SCHEDULE & CHECK CAPACITY
        // ==================================================
        const classSchedule = await HolidayClassSchedule.findByPk(data.classScheduleId);

        if (!classSchedule) throw new Error("Invalid class schedule ID");

        if (classSchedule.capacity < data.totalStudents) {
            throw new Error(
                `Not enough capacity in this class. Available: ${classSchedule.capacity}, Requested: ${data.totalStudents}`
            );
        }

        // ==================================================
        //  STRIPE PAYMENT
        // ==================================================
        let payment_status = "failed";
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

                const addCardRes = await addNewCard({
                    body: {
                        customer_id: customerId,
                        card_token: cardTokenRes.token_id,
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
                payment_status = "paid";
                stripeChargeId = chargeRes.charge_id;

                // ✅ DECREASE CAPACITY AFTER SUCCESSFUL PAYMENT
                await classSchedule.update(
                    { capacity: classSchedule.capacity - data.totalStudents },
                    { transaction }
                );
            }
        } catch (err) {
            errorMessage = err.message;
            console.error("Stripe Payment Error:", err.message);
        }

        // ✅ Send confirmation email to first parent (only if payment succeeded)
        // ✅ Send confirmation email to first parent (only if payment succeeded)
        try {
            if (payment_status === "paid") { // <-- corrected
                const { status: configStatus, emailConfig, htmlTemplate, subject } =
                    await emailModel.getEmailConfig(PANEL, "holiday-camp-booking");

                if (configStatus && htmlTemplate) {
                    const firstStudent = students?.[0];
                    const firstParent = data.parents?.[0];

                    if (firstParent?.parentEmail) {
                        // Build HTML for all students
                        const studentsHtml = students.map(student => `
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

                        // Fetch venue name if needed
                        const venue = await HolidayVenue.findByPk(data.venueId); // make sure you import Venue model

                        // Build HTML email body using booking data
                        const htmlBody = htmlTemplate
                            .replace(/{{parentName}}/g, `${firstParent.parentFirstName} ${firstParent.parentLastName}`)
                            .replace(/{{venueName}}/g, venue?.name || "")
                            .replace(/{{relationToChild}}/g, firstParent.relationToChild || "")
                            .replace(/{{parentPhoneNumber}}/g, firstParent.parentPhoneNumber || "")
                            .replace(/{{className}}/g, "Holiday Camp")
                            .replace(/{{classTime}}/g, data.time || "")
                            .replace(/{{startDate}}/g, data.date || "")
                            .replace(/{{parentEmail}}/g, firstParent.parentEmail || "")
                            .replace(/{{parentPassword}}/g, "Synco123")
                            .replace(/{{appName}}/g, "Synco")
                            .replace(/{{year}}/g, new Date().getFullYear().toString())
                            .replace(/{{logoUrl}}/g, "https://webstepdev.com/demo/syncoUploads/syncoLogo.png")
                            .replace(/{{kidsPlaying}}/g, "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png")
                            .replace(/{{studentsTable}}/g, studentsHtml);

                        await sendEmail(emailConfig, {
                            recipient: [{ name: `${firstParent.parentFirstName} ${firstParent.parentLastName}`, email: firstParent.parentEmail }],
                            subject,
                            htmlBody,
                        });

                        console.log(`📧 Confirmation email sent to ${firstParent.parentEmail}`);
                    } else {
                        console.warn("⚠️ No parent email found for sending booking confirmation");
                    }
                } else {
                    console.warn("⚠️ Email template config not found for 'holiday-booking'");
                }
            } else {
                console.log("ℹ️ Payment not successful — skipping email send.");
            }
        } catch (emailErr) {
            console.error("❌ Error sending email to parent:", emailErr.message);
        }

        await HolidayBookingPayment.create(
            {
                holiday_booking_id: booking.id,
                amount: finalAmount,
                discount_amount,
                base_amount,
                payment_status,
                stripe_payment_intent_id: stripeChargeId,
                payment_date: new Date(),
                failureReason: errorMessage,
            },
            { transaction }
        );

        await transaction.commit();

        return {
            success: true,
            bookingId: booking.id,
            payment_status,
            stripe_payment_intent_id: stripeChargeId,
            base_amount,
            discount_amount,
            finalAmount,
        };
    } catch (error) {
        await transaction.rollback();
        console.error("❌ Error creating holiday booking:", error);
        throw error;
    }
};

exports.getHolidayBooking = async (superAdminId, adminId) => {
    try {
        // Validate admin ID
        if (!adminId || isNaN(Number(adminId))) {
            return { success: false, message: "Invalid admin ID.", data: [] };
        }

        const whereBooking = {};

        // Determine accessible bookings
        if (superAdminId && superAdminId === adminId) {
            const managedAdmins = await Admin.findAll({
                where: { superAdminId },
                attributes: ["id"]
            });

            const adminIds = managedAdmins.map(a => a.id);
            adminIds.push(superAdminId);

            whereBooking.bookedBy = { [Op.in]: adminIds };
        } else if (superAdminId && adminId) {
            whereBooking.bookedBy = { [Op.in]: [adminId, superAdminId] };
        } else {
            whereBooking.bookedBy = adminId;
        }

        // Fetch booking + relations
        let bookings = await HolidayBooking.findAll({
            where: whereBooking,
            include: [
                {
                    model: HolidayBookingStudentMeta,
                    as: "students",
                    attributes: [
                        "id",
                        "bookingId",
                        "attendance",
                        "studentFirstName",
                        "studentLastName",
                        "dateOfBirth",
                        "age",
                        "gender",
                        "medicalInformation",
                        "createdAt",
                        "updatedAt",
                    ],
                    include: [
                        {
                            model: HolidayBookingParentMeta,
                            as: "parents",
                        },
                        {
                            model: HolidayBookingEmergencyMeta,
                            as: "emergencyContacts",
                        }
                    ]
                },

                { model: HolidayBookingPayment, as: "payment" },
                { model: HolidayPaymentPlan, as: "holidayPaymentPlan" },
                { model: HolidayVenue, as: "holidayVenue" },
                { model: HolidayClassSchedule, as: "holidayClassSchedules" },
                {
                    model: Admin,
                    as: "bookedByAdmin",
                    attributes: ["id", "firstName", "lastName"]
                },
                {
                    model: HolidayCamp,
                    as: "holidayCamp",
                    include: [
                        {
                            model: HolidayCampDates,
                            as: "holidayCampDates"
                        }
                    ]
                },

                { model: Discount, as: "discount" }
            ],
            order: [["id", "DESC"]]
        });

        // ---------------------------
        // TRANSFORM TO FINAL JSON
        // ---------------------------
        bookings = bookings.map(record => {
            const booking = record.toJSON();

            // ---------------------------
            // Extract ALL parents & dedupe
            // ---------------------------
            const parentMap = {};
            booking.students.forEach(student => {
                (student.parents || []).forEach(parent => {
                    parentMap[parent.id] = parent;
                });
                delete student.parents; // remove from inside student
            });
            booking.parents = Object.values(parentMap);

            // ---------------------------
            // Extract ALL emergency contacts & dedupe
            // ---------------------------
            const emergencyMap = {};
            booking.students.forEach(student => {
                (student.emergencyContacts || []).forEach(ec => {
                    emergencyMap[ec.id] = ec;
                });
                delete student.emergencyContacts; // remove from inside student
            });
            booking.emergencyContacts = Object.values(emergencyMap);

            return booking;
        });
        // ---------- SUMMARY METRICS ----------
        let totalStudents = 0;
        let revenue = 0;
        let sourceCount = {}; // count based on admin full name

        bookings.forEach(b => {

            // Count students
            if (b.students && Array.isArray(b.students)) {
                totalStudents += b.students.length;
            }

            // Revenue
            if (b.payment && b.payment.amount) {
                revenue += Number(b.payment.amount);
            }

            // Count sources (admin name)
            if (b.bookedByAdmin) {
                const fullName =
                    `${b.bookedByAdmin.firstName} ${b.bookedByAdmin.lastName}`.trim();

                sourceCount[fullName] = (sourceCount[fullName] || 0) + 1;
            }
        });

        // Average price
        const averagePrice = bookings.length > 0
            ? revenue / bookings.length
            : 0;

        // Top source (most frequent admin)
        let topSource = null;
        if (Object.keys(sourceCount).length > 0) {
            topSource = Object.entries(sourceCount)
                .sort((a, b) => b[1] - a[1])[0][0];
        }
        return {
            success: true,
            // count: bookings.length,
            summary: {
                totalStudents,
                revenue,
                averagePrice,
                topSource
            },
            data: bookings
        };

    } catch (error) {
        console.error("❌ Error fetching holiday bookings:", error);
        return {
            success: false,
            message: "Failed to fetch holiday booking data",
            error: error.message
        };
    }
};
exports.getBookingById = async (bookingId, superAdminId, adminId) => {
  try {
    // Validate bookingId
    if (!bookingId || isNaN(Number(bookingId))) {
      return { success: false, message: "Invalid booking ID." };
    }

    // Build access filter
    const whereBooking = { id: bookingId };

    if (superAdminId && superAdminId === adminId) {
      // super admin can access
      whereBooking.bookedBy = { [Op.in]: [superAdminId] };
    } else if (superAdminId && adminId) {
      whereBooking.bookedBy = { [Op.in]: [adminId, superAdminId] };
    } else if (adminId) {
      whereBooking.bookedBy = adminId;
    }

    // Fetch booking with full relations (same as getHolidayBooking)
    let record = await HolidayBooking.findOne({
      where: whereBooking,
      include: [
        {
          model: HolidayBookingStudentMeta,
          as: "students",
          include: [
            { model: HolidayBookingParentMeta, as: "parents" },
            { model: HolidayBookingEmergencyMeta, as: "emergencyContacts" }
          ]
        },

        { model: HolidayBookingPayment, as: "payment" },
        { model: HolidayPaymentPlan, as: "holidayPaymentPlan" },
        { model: HolidayVenue, as: "holidayVenue" },
        { model: HolidayClassSchedule, as: "holidayClassSchedules" },
        { model: Discount, as: "discount" },

        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: ["id", "firstName", "lastName"]
        },
        {
          model: HolidayCamp,
          as: "holidayCamp",
          include: [{ model: HolidayCampDates, as: "holidayCampDates" }]
        }
      ]
    });

    if (!record) {
      return { success: false, message: "Booking not found or access denied." };
    }

    // Convert to JSON
    let booking = record.toJSON();

    // ---------------------------
    // Parent extraction + merge
    // ---------------------------
    const parentMap = {};
    booking.students.forEach(st => {
      (st.parents || []).forEach(p => { parentMap[p.id] = p; });
      delete st.parents; 
    });
    booking.parents = Object.values(parentMap);

    // ---------------------------
    // Emergency extraction + merge
    // ---------------------------
    const emergencyMap = {};
    booking.students.forEach(st => {
      (st.emergencyContacts || []).forEach(ec => { emergencyMap[ec.id] = ec; });
      delete st.emergencyContacts;
    });
    booking.emergencyContacts = Object.values(emergencyMap);

    // ---------------------------
    // SUMMARY METRICS (single booking)
    // ---------------------------
    const totalStudents = booking.students?.length || 0;
    const revenue = booking.payment?.amount ? Number(booking.payment.amount) : 0;
    const averagePrice = revenue; // since single booking
    const topSource = booking.bookedByAdmin
      ? `${booking.bookedByAdmin.firstName} ${booking.bookedByAdmin.lastName}`
      : null;

    return {
      success: true,
      summary: {
        totalStudents,
        revenue,
        averagePrice,
        topSource
      },
      data: booking
    };

  } catch (error) {
    console.error("❌ getBookingById service error:", error);
    return { success: false, message: error.message };
  }
};

exports.sendEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch booking
    const booking = await HolidayBooking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Fetch all students in booking
    const studentMetas = await HolidayBookingStudentMeta.findAll({
      where: { bookingId },
    });

    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 3️⃣ Fetch venue & class schedule
    const venue = await HolidayVenue.findByPk(booking.venueId);
    const classSchedule = await HolidayClassSchedule.findByPk(booking.classScheduleId);

    const venueName = venue?.venueName || venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const classTime =
      classSchedule?.classTime || classSchedule?.startTime || "TBA";

    const startDate = booking.startDate || "TBA";
    const additionalNote = booking.additionalNote?.trim() || "";

    // 4️⃣ Load email config/template
    const emailConfigResult = await getEmailConfig(
      "admin",
      "send-email-holiday-listing"
    );

    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    const sentTo = [];

    // 5️⃣ Build students HTML list
    const studentsHtml = `
      <ul>
        ${studentMetas
          .map(
            (s) =>
              `<li>${s.studentFirstName} ${s.studentLastName} (Age: ${s.age}, Gender: ${s.gender})</li>`
          )
          .join("")}
      </ul>
    `;

    // 6️⃣ Fetch ALL parents for these students
    const allParents = await HolidayBookingParentMeta.findAll({
      where: { studentId: studentMetas.map((s) => s.id) },
    });

    // Deduplicate by email
    const uniqueParents = {};
    allParents.forEach((p) => {
      if (p.parentEmail) uniqueParents[p.parentEmail] = p;
    });

    // 7️⃣ Email each parent
    for (const parentEmail in uniqueParents) {
      const parent = uniqueParents[parentEmail];

      const noteHtml = additionalNote
        ? `<p><strong>Additional Note:</strong> ${additionalNote}</p>`
        : "";

      // Replace template variables
      const finalHtml = htmlTemplate
        .replace(/{{parentName}}/g, parent.parentFirstName)
        .replace(/{{studentsList}}/g, studentsHtml)
        .replace(/{{status}}/g, booking.status)
        .replace(/{{venueName}}/g, venueName)
        .replace(/{{className}}/g, className)
        .replace(/{{classTime}}/g, classTime)
        .replace(/{{startDate}}/g, startDate)
        .replace(/{{additionalNoteSection}}/g, noteHtml)
        .replace(/{{appName}}/g, "Synco")
        .replace(/{{logoUrl}}/g, "https://webstepdev.com/demo/syncoUploads/syncoLogo.png")
        .replace(/{{kidsPlaying}}/g, "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png")
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
    console.error("❌ sendEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

exports.updateHolidayBookingById = async (bookingId, data, adminId) => {
  const transaction = await sequelize.transaction();

  try {
    const booking = await HolidayBooking.findByPk(bookingId, {
      include: [
        { model: HolidayBookingStudentMeta, as: "students", include: [
          { model: HolidayBookingParentMeta, as: "parents" },
          { model: HolidayBookingEmergencyMeta, as: "emergencyContacts" }
        ] }
      ],
      transaction
    });

    if (!booking) throw new Error("Booking not found");

    // --------------------------------------------------
    // 1️⃣ Handle new students
    // --------------------------------------------------
    const newStudents = data.students || [];
    if (newStudents.length > 3) {
      throw new Error("You can add a maximum of 3 students at a time");
    }

    // Capacity check
    const classSchedule = await HolidayClassSchedule.findByPk(booking.classScheduleId, { transaction });
    if (!classSchedule) throw new Error("Class schedule not found");

    if (classSchedule.capacity < newStudents.length) {
      throw new Error(`Not enough capacity. Available: ${classSchedule.capacity}, Requested: ${newStudents.length}`);
    }

    const createdStudents = [];

    for (const studentData of newStudents) {
      const newStudent = await HolidayBookingStudentMeta.create({
        bookingId: booking.id,
        studentFirstName: studentData.studentFirstName,
        studentLastName: studentData.studentLastName,
        dateOfBirth: studentData.dateOfBirth,
        age: studentData.age,
        gender: studentData.gender,
        medicalInformation: studentData.medicalInformation,
      }, { transaction });

      // Parents
      if (studentData.parents?.length) {
        await Promise.all(studentData.parents.map(p =>
          HolidayBookingParentMeta.create({
            studentId: newStudent.id,
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          }, { transaction })
        ));
      }

      // Emergency contacts
      if (studentData.emergency) {
        await HolidayBookingEmergencyMeta.create({
          studentId: newStudent.id,
          emergencyFirstName: studentData.emergency.emergencyFirstName,
          emergencyLastName: studentData.emergency.emergencyLastName,
          emergencyPhoneNumber: studentData.emergency.emergencyPhoneNumber,
          emergencyRelation: studentData.emergency.emergencyRelation,
        }, { transaction });
      }

      createdStudents.push(newStudent);
    }

    // Update total students & class capacity
    if (createdStudents.length > 0) {
      booking.totalStudents += createdStudents.length;
      await booking.save({ transaction });

      await classSchedule.update(
        { capacity: classSchedule.capacity - createdStudents.length },
        { transaction }
      );
    }

    // --------------------------------------------------
    // 2️⃣ Update parents & emergency contacts for existing students
    // --------------------------------------------------
    if (data.parents?.length) {
      for (const parentData of data.parents) {
        if (!parentData.parentId) continue;
        await HolidayBookingParentMeta.update({
          parentFirstName: parentData.parentFirstName,
          parentLastName: parentData.parentLastName,
          parentEmail: parentData.parentEmail,
          parentPhoneNumber: parentData.parentPhoneNumber,
          relationToChild: parentData.relationToChild,
          howDidYouHear: parentData.howDidYouHear,
        }, { where: { id: parentData.parentId }, transaction });
      }
    }

    if (data.emergencyContacts?.length) {
      for (const emergencyData of data.emergencyContacts) {
        if (!emergencyData.emergencyId) continue;
        await HolidayBookingEmergencyMeta.update({
          emergencyFirstName: emergencyData.emergencyFirstName,
          emergencyLastName: emergencyData.emergencyLastName,
          emergencyPhoneNumber: emergencyData.emergencyPhoneNumber,
          emergencyRelation: emergencyData.emergencyRelation,
        }, { where: { id: emergencyData.emergencyId }, transaction });
      }
    }

    await transaction.commit();

    return {
      success: true,
      message: "Booking updated successfully",
      data: {
        bookingId: booking.id,
        totalStudents: booking.totalStudents,
        addedStudents: createdStudents.length,
      }
    };
  } catch (error) {
    await transaction.rollback();
    console.error("❌ updateHolidayBookingById Error:", error);
    throw error;
  }
};
