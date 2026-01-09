const { Op, fn, col, literal } = require("sequelize");
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
  DiscountUsage,
  DiscountAppliesTo,
  Comment,
  Admin,
  AdminRole,
  //  sequelize
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
const moment = require("moment");
const debug = require("debug")("service:comments");
const bcrypt = require("bcrypt");

const DEBUG = process.env.DEBUG === "true";
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
      discount = await Discount.findByPk(data.discountId, {
        include: [{ model: DiscountAppliesTo, as: "appliesTo" }]
      });
      if (!discount) throw new Error("Invalid discount ID");

      const now = new Date();

      // 1️⃣ Validate active date
      if (discount.startDatetime && now < new Date(discount.startDatetime))
        throw new Error(`Discount ${discount.code} is not active yet.`);

      if (discount.endDatetime && now > new Date(discount.endDatetime))
        throw new Error(`Discount ${discount.code} has expired.`);

      // 2️⃣ Validate applies-to
      const appliesToTargets = discount.appliesTo.map(a => a.target);
      if (!appliesToTargets.includes("holiday_camp")) {
        throw new Error(`Discount ${discount.code} is not valid for holiday camp bookings.`);
      }

      // 3️⃣ Validate total uses
      if (discount.limitTotalUses !== null) {
        const totalUsed = await HolidayBooking.count({
          where: { discountId: discount.id }
        });

        if (totalUsed >= discount.limitTotalUses) {
          throw new Error(`Discount ${discount.code} reached total usage limit.`);
        }
      }

      // 5️⃣ Apply discount value
      if (discount.valueType === "percentage") {
        discount_amount = (base_amount * Number(discount.value)) / 100;
      } else {
        discount_amount = Number(discount.value);
      }

      finalAmount = Math.max(base_amount - discount_amount, 0);
    }
    // ==================================================
    //  CREATE / FIND PARENT ADMIN (FIRST PARENT)
    // ==================================================
    let parentAdminId = null;

    if (data.parents?.length > 0) {
      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (!email) {
        throw new Error("Parent email is required");
      }

      const parentRole = await AdminRole.findOne({
        where: { role: "Parents" },
        transaction,
      });

      if (!parentRole) {
        throw new Error("Parent role not found");
      }

      const hashedPassword = await bcrypt.hash("Synco123", 10);

      const [admin, created] = await Admin.findOrCreate({
        where: { email },
        defaults: {
          firstName: firstParent.parentFirstName || "Parent",
          lastName: firstParent.parentLastName || "",
          phoneNumber: firstParent.parentPhoneNumber || "",
          email,
          password: hashedPassword,
          roleId: parentRole.id,
          status: "active",
        },
        transaction,
      });

      // ✅ IMPORTANT
      parentAdminId = admin.id;

      // Optional update if already exists
      if (!created) {
        await admin.update(
          {
            firstName: firstParent.parentFirstName,
            lastName: firstParent.parentLastName,
            phoneNumber: firstParent.parentPhoneNumber || "",
          },
          { transaction }
        );
      }
    }

    // ==================================================
    //  CREATE BOOKING
    // ==================================================
    const isAdminBooking = !!adminId;

    const booking = await HolidayBooking.create(
      {
        venueId: data.venueId,
        classScheduleId: data.classScheduleId,
        holidayCampId: data.holidayCampId,
        discountId: data.discountId ?? null,
        totalStudents: data.totalStudents,
        paymentPlanId: data.paymentPlanId,
        status: "active",

        // ✅ AUTO-DETECT SOURCE
        bookedBy: isAdminBooking ? adminId : null,
        marketingChannel: isAdminBooking ? "admin" : "website",

        parentAdminId,
        bookingType: "paid",
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
    // ⭐ RECORD DISCOUNT USAGE
    if (discount && payment_status === "paid") {
      await DiscountUsage.create(
        {
          discountId: discount.id,
          adminId,
          usedAt: new Date()
        },
        { transaction }
      );
    }
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
              // .replace(/{{date}}/g, data.date || "")
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
        base_amount,
        discount_amount,
        payment_status,
        stripe_payment_intent_id: stripeChargeId,
        payment_date: new Date(),
        failureReason: errorMessage,

        // ⭐ Save payment info
        firstName: data.payment?.firstName,
        lastName: data.payment?.lastName,
        email: data.payment?.email,
        billingAddress: data.payment?.billingAddress,

        // If you want to save the card details (not recommended in production)
        cardNumber: data.payment?.cardNumber,
        expiryDate: data.payment?.expiryDate,
        securityCode: data.payment?.securityCode,
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
    let adminIds = [];

    // ------------------------------------
    // SUPER ADMIN
    // ------------------------------------
    if (superAdminId && superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"]
      });

      adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);

      whereBooking[Op.or] = [
        // 1️⃣ Admin-created bookings
        {
          bookedBy: { [Op.in]: adminIds },
        },

        // 2️⃣ Website bookings → venues created by this super admin
        {
          bookedBy: null,
          "$holidayClassSchedules.venue.createdBy$": {
            [Op.in]: adminIds,
          },
        },
      ];
    }

    // ------------------------------------
    // ADMIN
    // ------------------------------------
    else if (superAdminId && adminId) {
      adminIds = [adminId, superAdminId];

      whereBooking[Op.or] = [
        // 1️⃣ Admin-created bookings
        {
          bookedBy: { [Op.in]: adminIds },
        },

        // 2️⃣ Website bookings → admin + super admin venues
        {
          bookedBy: null,
          "$holidayClassSchedules.venue.createdBy$": {
            [Op.in]: adminIds,
          },
        },
      ];
    }

    // ------------------------------------
    // AGENT / FALLBACK
    // ------------------------------------
    else {
      whereBooking.bookedBy = adminId;
    }

    // Fetch booking + relations
    let bookings = await HolidayBooking.findAll({
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

        {
          model: HolidayClassSchedule,
          as: "holidayClassSchedules",
          include: [
            {
              model: HolidayVenue,
              as: "venue",
              attributes: ["id", "createdBy"]
            }
          ]
        },

        // Flat (for response compatibility)
        {
          model: HolidayVenue,
          as: "holidayVenue",
          required: false
        },

        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: ["id", "firstName", "lastName"]
        },

        {
          model: HolidayCamp,
          as: "holidayCamp",
          include: [{ model: HolidayCampDates, as: "holidayCampDates" }]
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
      if (b.payment?.amount) {
        revenue += Number(b.payment.amount);
      }

      // After loop (IMPORTANT)
      revenue = Number(revenue.toFixed(2));
      // Count sources (admin name)
      if (b.bookedByAdmin) {
        const fullName =
          `${b.bookedByAdmin.firstName} ${b.bookedByAdmin.lastName}`.trim();

        sourceCount[fullName] = (sourceCount[fullName] || 0) + 1;
      }
    });

    // Average price
    const averagePrice = bookings.length > 0
      ? Number((revenue / bookings.length).toFixed(2))
      : 0;

    // Top source (most frequent admin)
    let topSource = null;
    if (Object.keys(sourceCount).length > 0) {
      topSource = Object.entries(sourceCount)
        .sort((a, b) => b[1] - a[1])[0][0];
    }
    return {
      status: true,
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

exports.assignBookingsToAgent = async ({ bookingIds, bookedBy }) => {
  const t = await sequelize.transaction();

  try {
    // Validation
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      throw new Error("At least one booking ID is required");
    }
    if (!bookedBy || isNaN(Number(bookedBy))) {
      throw new Error("Valid agent ID is required");
    }

    // Check Agent Exists
    const agent = await Admin.findByPk(bookedBy, {
      include: [{ model: AdminRole, as: "role" }],
      transaction: t,
    });
    if (!agent) {
      throw new Error("Agent not found");
    }

    // Fetch Bookings with students and parents eager loaded
    const bookings = await HolidayBooking.findAll({
      where: {
        id: { [Op.in]: bookingIds },
      },
      include: [
        {
          model: HolidayBookingStudentMeta,
          as: "students",
          include: [
            { model: HolidayBookingParentMeta, as: "parents", required: false },
          ],
          required: false,
        },
      ],
      transaction: t,
    });

    if (bookings.length !== bookingIds.length) {
      throw new Error("One or more bookings were not found");
    }

    // Filter bookings that are already assigned
    const alreadyAssigned = bookings.filter((b) => b.bookedBy);

    if (alreadyAssigned.length > 0) {
      // Build detailed info for error message
      const detailedInfo = alreadyAssigned.map((booking) => {
        const studentNames = booking.students
          ?.map(
            (s) => `${s.studentFirstName || ""} ${s.studentLastName || ""}`.trim()
          )
          .filter(Boolean)
          .join(", ") || "N/A";

        const parentNames = booking.students
          ?.flatMap((s) =>
            s.parents?.map(
              (p) => `${p.parentFirstName || ""} ${p.parentLastName || ""}`.trim()
            ) || []
          )
          .filter(Boolean)
          .join(", ") || "N/A";

        return `Student(s): ${studentNames}; Parent(s): ${parentNames}`;
      });

      throw new Error(
        `Some bookings are already assigned: ${detailedInfo.join(" | ")}`
      );
    }

    // Bulk update bookings
    await HolidayBooking.update(
      {
        bookedBy,
        updatedAt: new Date(),
      },
      {
        where: {
          id: { [Op.in]: bookingIds },
        },
        transaction: t,
      }
    );

    await t.commit();

    return {
      status: true,
      message: "Bookings successfully assigned to agent",
      data: {
        bookingIds,
        bookedBy,
        totalAssigned: bookingIds.length,
      },
    };
  } catch (error) {
    await t.rollback();
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.cancelHolidayBookingById = async (bookingId, data, adminId) => {
  const transaction = await sequelize.transaction();

  try {
    // 1️⃣ Fetch booking
    const booking = await HolidayBooking.findByPk(bookingId);

    if (!booking) {
      throw new Error("Booking not found.");
    }

    // 2️⃣ Prevent duplicate cancellation
    if (booking.status === "cancelled") {
      throw new Error("Booking is already cancelled.");
    }

    // 3️⃣ Update booking status + save fields
    await booking.update(
      {
        status: "cancelled",
        bookingType: "cancelled",    // as per your requirement
        cancelReason: data.cancelReason || null,
        additionalNotes: data.additionalNotes || null,
      },
      { transaction }
    );

    // 4️⃣ Restore class capacity (optional – uncomment if needed)
    const classSchedule = await HolidayClassSchedule.findByPk(booking.classScheduleId);
    if (classSchedule) {
      await classSchedule.update(
        { capacity: classSchedule.capacity + booking.totalStudents },
        { transaction }
      );
    }

    await transaction.commit();

    return {
      success: true,
      message: "Booking cancelled successfully.",
      bookingId: booking.id,
    };
  } catch (error) {
    await transaction.rollback();
    console.error("❌ Error cancelling holiday booking:", error.message);
    throw error;
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

    let adminIds = [];

    if (superAdminId && superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"]
      });

      adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);

      whereBooking[Op.or] = [
        // 1️⃣ Admin-created booking
        {
          bookedBy: { [Op.in]: adminIds },
        },

        // 2️⃣ Website booking → venue created by this super admin
        {
          bookedBy: null,
          "$holidayClassSchedules.venue.createdBy$": {
            [Op.in]: adminIds,
          },
        },
      ];
    }

    else if (superAdminId && adminId) {
      adminIds = [adminId, superAdminId];

      whereBooking[Op.or] = [
        // 1️⃣ Admin-created booking
        {
          bookedBy: { [Op.in]: adminIds },
        },

        // 2️⃣ Website booking → venue created by admin or super admin
        {
          bookedBy: null,
          "$holidayClassSchedules.venue.createdBy$": {
            [Op.in]: adminIds,
          },
        },
      ];
    }

    else {
      whereBooking.bookedBy = adminId;
    }

    // Fetch with relations
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
        {
          model: HolidayClassSchedule,
          as: "holidayClassSchedules",
          include: [
            {
              model: HolidayVenue,
              as: "venue"
            }
          ]
        },
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

    let booking = record.toJSON();

    // ---------------------------
    // Parent extraction
    // ---------------------------
    const parentMap = {};
    booking.students.forEach(st => {
      (st.parents || []).forEach(p => { parentMap[p.id] = p; });
      delete st.parents;
    });
    booking.parents = Object.values(parentMap);

    // ---------------------------
    // Emergency extraction
    // ---------------------------
    const emergencyMap = {};
    booking.students.forEach(st => {
      (st.emergencyContacts || []).forEach(ec => { emergencyMap[ec.id] = ec; });
      delete st.emergencyContacts;
    });
    booking.emergencyContacts = Object.values(emergencyMap);

    // ---------------------------
    // Payment + Stripe details (fixed + consistent)
    // ---------------------------
    let paymentObj = null;

    if (booking.payment) {
      const stripeChargeId = booking.payment.stripe_payment_intent_id;
      let stripeChargeDetails = null;

      if (stripeChargeId) {
        try {
          const stripe = await stripePromise;

          if (stripeChargeId.startsWith("pi_")) {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              stripeChargeId,
              { expand: ["latest_charge", "latest_charge.balance_transaction"] }
            );

            if (paymentIntent.latest_charge) {
              stripeChargeDetails = paymentIntent.latest_charge;
            }
          } else if (stripeChargeId.startsWith("ch_")) {
            stripeChargeDetails = await stripe.charges.retrieve(stripeChargeId, {
              expand: ["balance_transaction"]
            });
          }
        } catch (err) {
          console.error("⚠️ Stripe details fetch failed:", err.message);
        }
      }

      // Build clean payment object
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
            fullResponse: stripeChargeDetails
          }
          : null
      };
    }

    // ---------------------------
    // SUMMARY
    // ---------------------------
    const totalStudents = booking.students?.length || 0;
    const revenue = booking.payment?.amount ? Number(booking.payment.amount) : 0;
    const averagePrice = revenue;

    const topSource = booking.bookedByAdmin
      ? `${booking.bookedByAdmin.firstName} ${booking.bookedByAdmin.lastName}`
      : null;

    return {
      success: true,
      message: "Holiday booking fetched successfully",

      data: {
        ...booking,
        payment: paymentObj
      },

      summary: {
        totalStudents,
        revenue,
        averagePrice,
        topSource
      }
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
        {
          model: HolidayBookingStudentMeta,
          as: "students",
          include: [
            { model: HolidayBookingParentMeta, as: "parents" },
            { model: HolidayBookingEmergencyMeta, as: "emergencyContacts" }
          ]
        }
      ],
      transaction
    });

    if (!booking) throw new Error("Booking not found");

    const classSchedule = await HolidayClassSchedule.findByPk(booking.classScheduleId, { transaction });
    if (!classSchedule) throw new Error("Class schedule not found");

    let addedStudentsCount = 0;
    let adminSynced = false;
    // ============================================================
    // 1️⃣ STUDENTS: UPDATE IF ID EXISTS, CREATE IF NOT
    // ============================================================
    if (Array.isArray(data.students)) {
      for (const student of data.students) {

        // ---------------------------
        // 🔹 UPDATE existing student
        // ---------------------------
        if (student.id) {
          await HolidayBookingStudentMeta.update(
            {
              studentFirstName: student.studentFirstName,
              studentLastName: student.studentLastName,
              dateOfBirth: student.dateOfBirth,
              age: student.age,
              gender: student.gender,
              medicalInformation: student.medicalInformation,
            },
            { where: { id: student.id }, transaction }
          );
        }

        // ---------------------------
        // 🔹 CREATE new student
        // ---------------------------
        else {
          if (classSchedule.capacity < 1) {
            throw new Error(`No capacity available. Remaining: ${classSchedule.capacity}`);
          }

          const newStudent = await HolidayBookingStudentMeta.create(
            {
              bookingId: booking.id,
              studentFirstName: student.studentFirstName,
              studentLastName: student.studentLastName,
              dateOfBirth: student.dateOfBirth,
              age: student.age,
              gender: student.gender,
              medicalInformation: student.medicalInformation,
            },
            { transaction }
          );

          addedStudentsCount++;
          classSchedule.capacity -= 1;
          await classSchedule.save({ transaction });
        }
      }
    }

    // If new students were added, update totalStudents
    if (addedStudentsCount > 0) {
      booking.totalStudents += addedStudentsCount;
      await booking.save({ transaction });
    }

    // ============================================================
    // 2️⃣ PARENTS: UPDATE IF ID EXISTS, CREATE IF NOT
    // ============================================================
    // ============================================================
    // 2️⃣ PARENTS: UPDATE IF ID EXISTS, CREATE IF NOT + ADMIN SYNC
    // ============================================================
    if (Array.isArray(data.parents)) {
      for (let index = 0; index < data.parents.length; index++) {
        const p = data.parents[index];

        const isFirstParent =
          index === 0 && booking.parentAdminId && !adminSynced;

        // 🔒 Admin email uniqueness check (FIRST parent only)
        if (isFirstParent && p.parentEmail) {
          const admin = await Admin.findByPk(booking.parentAdminId, {
            transaction,
            paranoid: false,
          });

          if (admin && p.parentEmail !== admin.email) {
            const emailExists = await Admin.findOne({
              where: {
                email: p.parentEmail,
                id: { [Op.ne]: admin.id },
              },
              transaction,
              paranoid: false,
            });

            if (emailExists) {
              throw new Error("This email is already in use");
            }
          }
        }

        // ============================
        // UPDATE parent
        // ============================
        if (p.id) {
          await HolidayBookingParentMeta.update(
            {
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            },
            { where: { id: p.id }, transaction }
          );
        }

        // ============================
        // CREATE parent
        // ============================
        else {
          if (!p.studentId) continue;

          await HolidayBookingParentMeta.create(
            {
              studentId: p.studentId,
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            },
            { transaction }
          );
        }

        // 🔹 Sync FIRST parent → Admin (ONCE)
        if (isFirstParent) {
          const admin = await Admin.findByPk(booking.parentAdminId, {
            transaction,
            paranoid: false,
          });

          if (admin) {
            if (p.parentFirstName !== undefined)
              admin.firstName = p.parentFirstName;

            if (p.parentLastName !== undefined)
              admin.lastName = p.parentLastName;

            if (p.parentEmail !== undefined)
              admin.email = p.parentEmail;

            if (p.parentPhoneNumber !== undefined)
              admin.phoneNumber = p.parentPhoneNumber;

            await admin.save({ transaction });
            adminSynced = true;
          }
        }
      }
    }

    // ============================================================
    // 3️⃣ EMERGENCY CONTACTS: UPDATE IF ID EXISTS, CREATE IF NOT
    // ============================================================
    if (Array.isArray(data.emergencyContacts)) {
      for (const e of data.emergencyContacts) {

        // UPDATE existing emergency contact
        if (e.id) {
          await HolidayBookingEmergencyMeta.update(
            {
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            },
            { where: { id: e.id }, transaction }
          );
        }

        // CREATE new emergency contact
        else {
          if (!e.studentId) continue;

          await HolidayBookingEmergencyMeta.create(
            {
              studentId: e.studentId,
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            },
            { transaction }
          );
        }
      }
    }

    await transaction.commit();

    return {
      success: true,
      message: "Booking updated successfully",
      details: {
        addedStudents: addedStudentsCount,
        totalStudents: booking.totalStudents,
      }
    };

  } catch (error) {
    await transaction.rollback();
    console.error("❌ updateHolidayBookingById Error:", error);
    throw error;
  }
};

exports.waitingListCreate = async (data, adminId) => {
  const transaction = await sequelize.transaction();
  try {
    // ==================================================
    //  CREATE / FIND PARENT ADMIN (FIRST PARENT)
    // ==================================================
    let parentAdminId = null;

    if (data.parents?.length > 0) {
      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (!email) throw new Error("Parent email is required");

      const parentRole = await AdminRole.findOne({
        where: { role: "Parents" },
        transaction,
      });

      if (!parentRole) {
        throw new Error("Parent role not found");
      }

      // 🔒 CHECK IF EMAIL ALREADY USED BY NON-PARENT
      const existingAdmin = await Admin.findOne({
        where: { email },
        transaction,
      });

      if (existingAdmin && existingAdmin.roleId !== parentRole.id) {
        throw new Error(
          "This email is already registered with another account. Please use a different email."
        );
      }

      const hashedPassword = await bcrypt.hash("Synco123", 10);

      const [parentAdmin, created] = await Admin.findOrCreate({
        where: { email },
        defaults: {
          firstName: firstParent.parentFirstName || "Parent",
          lastName: firstParent.parentLastName || "",
          phoneNumber: firstParent.parentPhoneNumber || "",
          email,
          password: hashedPassword,
          roleId: parentRole.id,
          status: "active",
        },
        transaction,
      });

      parentAdminId = parentAdmin.id;

      // Optional update if already parent
      if (!created) {
        await parentAdmin.update(
          {
            firstName: firstParent.parentFirstName,
            lastName: firstParent.parentLastName,
            phoneNumber: firstParent.parentPhoneNumber || "",
          },
          { transaction }
        );
      }
    }

    // ==================================================
    //  CREATE WAITING-LIST BOOKING
    // ==================================================
    const isAdminBooking = !!adminId;
    const booking = await HolidayBooking.create(
      {
        venueId: data.venueId,
        parentAdminId,
        classScheduleId: data.classScheduleId,
        holidayCampId: data.holidayCampId,
        totalStudents: data.totalStudents,
        status: "waiting list",
        bookingType: "waiting list",
        type: "waiting list",
        serviceType: "holiday camp",
        // ✅ AUTO-DETECT SOURCE
        bookedBy: isAdminBooking ? adminId : null,
        marketingChannel: isAdminBooking ? "admin" : "website",
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
    //  CHECK CLASS SCHEDULE CAPACITY
    // ==================================================
    const classSchedule = await HolidayClassSchedule.findByPk(data.classScheduleId);

    if (!classSchedule) {
      throw new Error("Invalid class schedule ID");
    }

    // If capacity exists — do NOT allow waiting list
    if (classSchedule.capacity > 0) {
      return {
        success: false,
        message: `This class still has capacity = ${classSchedule.capacity}. You cannot join the waiting list.`,
      };
    }

    // ==================================================
    //  SEND EMAIL (NO PAYMENT LOGIC)
    // ==================================================
    try {
      const { status: configStatus, emailConfig, htmlTemplate, subject } =
        await emailModel.getEmailConfig(PANEL, "holiday-camp-booking-waiting-list");

      if (configStatus && htmlTemplate) {
        const firstParent = data.parents?.[0];

        if (firstParent?.parentEmail) {
          const studentsHtml = students
            .map(
              (student) => `
                <tr>
                    <td style="padding:5px;">
                        <p style="margin:0;font-size:13px;font-weight:600;">Student Name:</p>
                        <p style="margin:0;font-size:13px;">${student.studentFirstName} ${student.studentLastName}</p>
                    </td>
                    <td style="padding:5px;">
                        <p style="margin:0;font-size:13px;font-weight:600;">Age:</p>
                        <p style="margin:0;font-size:13px;">${student.age}</p>
                    </td>
                    <td style="padding:5px;">
                        <p style="margin:0;font-size:13px;font-weight:600;">Gender:</p>
                        <p style="margin:0;font-size:13px;">${student.gender}</p>
                    </td>
                </tr>
            `
            )
            .join("");

          const venue = await HolidayVenue.findByPk(data.venueId);

          const htmlBody = htmlTemplate
            .replace(/{{parentName}}/g, `${firstParent.parentFirstName} ${firstParent.parentLastName}`)
            .replace(/{{venueName}}/g, venue?.name || "")
            .replace(/{{relationToChild}}/g, firstParent.relationToChild || "")
            .replace(/{{parentPhoneNumber}}/g, firstParent.parentPhoneNumber || "")
            .replace(/{{className}}/g, "Holiday Camp")
            .replace(/{{classTime}}/g, data.time || "")
            // .replace(/{{date}}/g, data.date || "")
            .replace(/{{parentEmail}}/g, firstParent.parentEmail || "")
            .replace(/{{parentPassword}}/g, "Synco123")
            .replace(/{{appName}}/g, "Synco")
            .replace(/{{year}}/g, new Date().getFullYear())
            .replace(/{{logoUrl}}/g, "https://webstepdev.com/demo/syncoUploads/syncoLogo.png")
            .replace(/{{kidsPlaying}}/g, "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png")
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

          console.log(`📧 Waiting-list email sent to ${firstParent.parentEmail}`);
        } else {
          console.warn("⚠️ No parent email found");
        }
      } else {
        console.warn("⚠️ Email template not found for 'holiday-camp-booking-waiting-list'");
      }
    } catch (emailErr) {
      console.error("❌ Email sending error:", emailErr.message);
    }

    await transaction.commit();

    return {
      success: true,
      message: "Waiting list booking created successfully.",
      bookingId: booking.id,
    };
  } catch (error) {
    await transaction.rollback();
    console.error("❌ Error creating waiting list booking:", error);
    throw error;
  }
};

// Helper to get startDate & endDate based on filterType
function getDateRange(filterType) {
  const now = new Date();
  let startDate, endDate;

  switch (filterType) {
    case "thisMonth":
      startDate = moment().startOf("month").toDate();
      endDate = moment().endOf("month").toDate();
      break;
    case "lastMonth":
      startDate = moment().subtract(1, "month").startOf("month").toDate();
      endDate = moment().subtract(1, "month").endOf("month").toDate();
      break;
    case "last3Months":
      startDate = moment().subtract(3, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();
      break;
    case "last6Months":
      startDate = moment().subtract(6, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();
      break;
    default:
      // Default: full year
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  }

  return { startDate, endDate };
}

exports.holidayCampsReports = async (superAdminId, adminId, filterType) => {
  try {
    //----------------------------------------
    // ACCESS CONTROL (same as getHolidayBooking)
    //----------------------------------------
    if (!adminId || isNaN(Number(adminId))) {
      return { success: false, message: "Invalid admin ID." };
    }

    const whereBooking = {};

    if (superAdminId && superAdminId === adminId) {
      // Super admin: include all managed admins + themselves
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"]
      });

      const adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);

      whereBooking.bookedBy = { [Op.in]: adminIds };

    } else if (superAdminId && adminId) {
      // Normal admin: include themselves + superAdmin
      whereBooking.bookedBy = { [Op.in]: [adminId, superAdminId] };

    } else {
      // Fallback
      whereBooking.bookedBy = adminId;
    }

    const allowed = Array.isArray(whereBooking.bookedBy?.[Op.in])
      ? whereBooking.bookedBy[Op.in]
      : [whereBooking.bookedBy];

    //----------------------------------------
    // FILTER DATE RANGE (optional)
    //----------------------------------------
    let filterStartDate = null;
    let filterEndDate = null;

    if (filterType) {
      const range = getDateRange(filterType);
      filterStartDate = range.startDate;
      filterEndDate = range.endDate;
    }

    const applyDateFilter = (where = {}) => {
      if (filterStartDate && filterEndDate) {
        where.createdAt = { [Op.between]: [filterStartDate, filterEndDate] };
      }
      return where;
    };

    //----------------------------------------
    // Date ranges
    //----------------------------------------
    const now = new Date();
    const startOfThisYear = new Date(now.getFullYear(), 0, 1);
    const endOfThisYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1);
    const endOfLastYear = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);

    const sqlDateCondition = filterStartDate
      ? `AND hb.createdAt BETWEEN :startDate AND :endDate`
      : ``;

    const sqlDateReplacements = filterStartDate
      ? { startDate: filterStartDate, endDate: filterEndDate }
      : {};
    //----------------------------------------
    // 1) TOTAL REVENUE
    //----------------------------------------
    const totalRevenue = Number(
      (
        await HolidayBookingPayment.sum("amount", {
          include: [
            {
              model: HolidayBooking,
              as: "booking",
              attributes: [],
              where: applyDateFilter({
                ...whereBooking
              })
            }
          ]
        })
      ) || 0
    );
    const revenueThisYearRow = await sequelize.query(
      `
  SELECT IFNULL(SUM(hbp.amount), 0) AS revenue
  FROM holiday_booking_payments hbp
  JOIN holiday_booking hb 
    ON hb.id = hbp.holiday_booking_id
  WHERE hb.bookedBy IN(:allowed)
  ${sqlDateCondition}
  `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          ...sqlDateReplacements
        }
      }
    );

    const revenueThisYear = Number(revenueThisYearRow?.[0]?.revenue || 0);

    const revenueLastYearRow = await sequelize.query(
      `
  SELECT IFNULL(SUM(hbp.amount), 0) AS revenue
  FROM holiday_booking_payments hbp
  JOIN holiday_booking hb 
    ON hb.id = hbp.holiday_booking_id
  WHERE hb.bookedBy IN(:allowed)
    AND hb.createdAt BETWEEN :startDate AND :endDate
  `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          startDate: startOfLastYear,
          endDate: endOfLastYear
        }
      }
    );

    const revenueLastYear = Number(revenueLastYearRow?.[0]?.revenue || 0);
    const maxRevenue = Math.max(revenueThisYear, revenueLastYear);
    const revenueAverageRaw =
      (revenueThisYear + revenueLastYear) / 2;
    const revenueAverage =
      maxRevenue === 0
        ? 0
        : Number(((revenueAverageRaw / maxRevenue) * 100).toFixed(2));

    //----------------------------------------
    // 2) AVERAGE REVENUE PER CAMP
    //----------------------------------------

    const avgRevenuePerCampThisYearRow = await sequelize.query(
      `
  SELECT 
    IFNULL(SUM(hbp.amount),0) / NULLIF(COUNT(DISTINCT hb.holidayCampId),0)
    AS avgRevenue
  FROM holiday_booking hb
  JOIN holiday_booking_payments hbp
    ON hbp.holiday_booking_id = hb.id
  WHERE hb.bookedBy IN(:allowed)
    AND hb.status = 'active'
    AND hb.createdAt BETWEEN :startDate AND :endDate
  `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          startDate: startOfThisYear,
          endDate: endOfThisYear
        }
      }
    );

    const avgRevenuePerCampThisYear = Number(
      avgRevenuePerCampThisYearRow[0]?.avgRevenue || 0
    );
    const avgRevenuePerCampLastYearRow = await sequelize.query(
      `
  SELECT 
    IFNULL(SUM(hbp.amount),0) / NULLIF(COUNT(DISTINCT hb.holidayCampId),0)
    AS avgRevenue
  FROM holiday_booking hb
  JOIN holiday_booking_payments hbp
    ON hbp.holiday_booking_id = hb.id
  WHERE hb.bookedBy IN(:allowed)
    AND hb.status = 'active'
    AND hb.createdAt BETWEEN :startDate AND :endDate
  `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          startDate: startOfLastYear,
          endDate: endOfLastYear
        }
      }
    );

    const avgRevenuePerCampLastYear = Number(
      avgRevenuePerCampLastYearRow[0]?.avgRevenue || 0
    );
    const avgRevenuePerCampGrowthPercent =
      avgRevenuePerCampLastYear === 0
        ? 0
        : Number(
          Math.min(
            ((avgRevenuePerCampThisYear - avgRevenuePerCampLastYear) /
              avgRevenuePerCampLastYear) *
            100,
            100
          ).toFixed(2)
        );

    // ---------------------------
    // 6 REVENUE GROWTH
    // --------------------------------
    const startOfYearBeforeLast = new Date(now.getFullYear() - 2, 0, 1);
    const endOfYearBeforeLast = new Date(now.getFullYear() - 2, 11, 31, 23, 59, 59);

    const revenueYearBeforeLastRow = await sequelize.query(
      `
  SELECT IFNULL(SUM(hbp.amount), 0) AS revenue
  FROM holiday_booking_payments hbp
  JOIN holiday_booking hb 
    ON hb.id = hbp.holiday_booking_id
  WHERE hb.bookedBy IN(:allowed)
    AND hb.createdAt BETWEEN :startDate AND :endDate
  `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          startDate: startOfYearBeforeLast,
          endDate: endOfYearBeforeLast
        }
      }
    );
    const revenueYearBeforeLast = Number(
      revenueYearBeforeLastRow?.[0]?.revenue || 0
    );

    const avgRevenueThisYear =
      Number(((revenueThisYear + revenueLastYear) / 2).toFixed(2));

    const avgRevenueLastYear =
      Number(((revenueLastYear + revenueYearBeforeLast) / 2).toFixed(2));

    // normalization base
    const maxAvgRevenue = Math.max(avgRevenueThisYear, avgRevenueLastYear);

    const revenueGrowth = {
      thisYear:
        maxAvgRevenue === 0
          ? 0
          : Number(((avgRevenueThisYear / maxAvgRevenue) * 100).toFixed(2)),

      lastYear:
        maxAvgRevenue === 0
          ? 0
          : Number(((avgRevenueLastYear / maxAvgRevenue) * 100).toFixed(2)),

      average:
        maxAvgRevenue === 0
          ? 0
          : Number(
            (((avgRevenueThisYear - avgRevenueLastYear) / maxAvgRevenue) * 100).toFixed(2)
          )
    };

    //----------------------------------------
    // 3) AVERAGE AGE
    //----------------------------------------
    const getAverageAge = async () => {
      const avgAgeRow = await HolidayBookingStudentMeta.findOne({
        attributes: [[sequelize.fn("AVG", sequelize.col("age")), "avgAge"]],
        include: [
          {
            model: HolidayBooking,
            as: "holidayBooking",
            attributes: [],
            where: applyDateFilter({
              status: "active",
              ...whereBooking
            }),
          },
        ],
        raw: true,
      });

      return Number(Number(avgAgeRow?.avgAge || 0).toFixed(2));
    };

    // Use your year boundaries
    const averageAgeThisYear = await getAverageAge();
    const averageAgeLastYear = averageAgeThisYear; // same range now

    // ----------------------------
    // 5) STUDENTS PER CAMP (active)
    // ----------------------------
    // ----------------------------
    // Fetch students per camp grouped by year & month
    const studentsPerCampRows = await HolidayBooking.findAll({
      attributes: [
        "holidayCampId",
        [sequelize.fn("YEAR", sequelize.col("createdAt")), "year"], // year
        [sequelize.fn("MONTH", sequelize.col("createdAt")), "month"], // 1-12
        [sequelize.fn("SUM", sequelize.col("totalStudents")), "enrolledStudents"],
        [sequelize.fn("COUNT", sequelize.col("id")), "bookingCount"],
      ],
      where: {
        status: "active",
        ...whereBooking,
        createdAt: {
          [Op.between]: [
            new Date(now.getFullYear() - 1, 0, 1),
            new Date(now.getFullYear(), 11, 31, 23, 59, 59),
          ]
        }
      },
      group: [
        "holidayCampId",
        sequelize.fn("YEAR", sequelize.col("createdAt")),
        sequelize.fn("MONTH", sequelize.col("createdAt")),
      ],
      raw: true,
    });

    // Month names
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    // Optional: per camp monthly map (if needed)
    const perCampMonthly = {};

    // Populate perCampMonthly
    studentsPerCampRows.forEach(row => {
      const campId = row.holidayCampId;
      const monthIndex = Number(row.month) - 1; // 0-11

      if (!perCampMonthly[campId]) {
        perCampMonthly[campId] = monthNames.map(name => ({
          month: name,
          students: 0,
          bookings: 0,
        }));
      }

      perCampMonthly[campId][monthIndex] = {
        month: monthNames[monthIndex],
        students: Number(row.enrolledStudents || 0),
        bookings: Number(row.bookingCount || 0),
      };
    });

    // Helper function to build monthly students per year
    const buildMonthlyStudents = (year) => {
      return monthNames.map((month, index) => {
        const monthEntries = studentsPerCampRows.filter(
          s => Number(s.month) - 1 === index && Number(s.year) === year
        );

        const students = monthEntries.reduce((sum, s) => sum + Number(s.enrolledStudents || 0), 0);
        const bookings = monthEntries.reduce((sum, s) => sum + Number(s.bookingCount || 0), 0);

        return { month, students, bookings };
      });
    };

    // Monthly students for this year & last year
    const monthlyStudentsThisYear = buildMonthlyStudents(now.getFullYear());
    const monthlyStudentsLastYear = buildMonthlyStudents(now.getFullYear() - 1);

    // ----------------------------
    // 6) CAMP REGISTRATIONS
    // ----------------------------
    const waitingPerCampRows = await HolidayBooking.findAll({
      attributes: [
        "holidayCampId",
        [sequelize.fn("COUNT", sequelize.col("id")), "waitingCount"],
      ],
      where: applyDateFilter({
        status: "waiting list",
        ...whereBooking
      }),
      group: ["holidayCampId"],
      raw: true,
    });

    const capacityRows = await HolidayClassSchedule.findAll({
      attributes: [
        "venueId",
        [sequelize.fn("SUM", sequelize.col("capacity")), "totalCapacity"],
      ],
      include: [
        {
          model: HolidayVenue,
          as: "venue", // ← correct alias for ClassSchedule
          attributes: ["id", "name"],
        },
      ],
      group: ["venueId", "venue.id"],
      raw: true,
    });

    const capacityMap = {};
    const enrolledMap = {};
    const waitingMap = {};

    capacityRows.forEach(r => (capacityMap[r.holidayCampId] = Number(r.totalCapacity || 0)));
    studentsPerCampRows.forEach(r => (enrolledMap[r.holidayCampId] = Number(r.enrolledStudents || 0)));
    waitingPerCampRows.forEach(r => (waitingMap[r.holidayCampId] = Number(r.waitingCount || 0)));

    const classScheduleRows = await HolidayClassSchedule.findAll({
      where: { status: "active" },
      attributes: ["id", "totalCapacity"],
      raw: true,
    });

    const classScheduleMap = {};
    classScheduleRows.forEach(r => {
      classScheduleMap[r.id] = { capacity: Number(r.totalCapacity || 0) };
    });

    const activeHolidayBookings = await HolidayBooking.findAll({
      where: applyDateFilter({
        status: "waiting list",
        ...whereBooking
      }),
      attributes: ["id", "classScheduleId", "totalStudents", "status"],
      raw: true,
    });

    // Function to calculate camp registration
    const getClassRegistrations = (classSchedule, holidayBooking) => {
      const activeBookingsMap = {};

      holidayBooking.forEach(booking => {
        if (booking.status === "active") {
          const id = booking.classScheduleId;
          activeBookingsMap[id] = (activeBookingsMap[id] || 0) + booking.totalStudents;
        }
      });

      const classRegistrations = Object.keys(classSchedule).map(idStr => {
        const id = Number(idStr);
        const capacity = Number(classSchedule[id]?.capacity || 0);
        const booked = Number(activeBookingsMap[id] || 0);

        const percentFilled = capacity > 0 ? Number(((booked / capacity) * 100).toFixed(2)) : 0;
        const untappedBusiness = Math.max(0, capacity - booked);

        return {
          classScheduleId: id,
          capacity,
          booked,
          percentFilled,
          untappedBusiness,
        };
      });

      return classRegistrations;
    };

    // Call the function
    // ---------- CAMPS REGISTRATION ----------
    const classRegistrations = getClassRegistrations(classScheduleMap, activeHolidayBookings);

    // Aggregate total percentFilled & untappedBusiness
    const totalCamps = classRegistrations.reduce(
      (acc, c) => {
        const pricePerStudent = c.pricePerStudent || 0; // अगर class price है
        acc.totalCapacity += c.capacity;
        acc.totalBooked += c.booked;
        acc.totalUntapped += (c.capacity - c.booked) * pricePerStudent;
        return acc;
      },
      { totalCapacity: 0, totalBooked: 0, totalUntapped: 0 }
    );

    const campsRegistration = {
      percentFilled:
        totalCamps.totalCapacity > 0
          ? Number(((totalCamps.totalBooked / totalCamps.totalCapacity) * 100).toFixed(2)) + "%"
          : "0%",
      untappedBusiness: totalCamps.totalUntapped // in ₹
    };

    // ----------------------------
    // 7) REGISTRATION PER CAMP (active)
    // ----------------------------
    const revenuePerCampActive = await sequelize.query(
      `
        SELECT hb.holidayCampId AS holidayCampId,
        IFNULL(SUM(hbp.amount),0) AS revenue
        FROM holiday_booking hb
        LEFT JOIN holiday_booking_payments hbp ON hbp.holiday_booking_id = hb.id
       WHERE hb.status='active'
AND hb.bookedBy IN(:allowed)
${sqlDateCondition}
        GROUP BY hb.holidayCampId
      `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          ...sqlDateReplacements
        }

      }
    );

    const revenuePerCampActiveMap = revenuePerCampActive.reduce((acc, r) => {
      acc[r.holidayCampId] = Number(r.revenue || 0);
      return acc;
    }, {});

    const totalActiveRevenue = Object.values(revenuePerCampActiveMap).reduce(
      (s, v) => s + v,
      0
    );

    const registrationPerCamp = Object.keys(revenuePerCampActiveMap).map(k => {
      const campId = Number(k);
      const revenue = revenuePerCampActiveMap[campId] || 0;

      return {
        holidayCampId: campId,
        revenue: Number(revenue.toFixed(2)),
        percentOfTotal:
          totalActiveRevenue > 0
            ? Number(((revenue / totalActiveRevenue) * 100).toFixed(2))
            : 0,
      };
    });

    // ----------------------------
    // 8) REGISTRATION PER CAMP GROWTH AND REVENUE
    // ----------------------------

    // 1️⃣ Fetch total revenue per venue (all active bookings)
    const revenuePerVenueRows = await sequelize.query(
      `
  SELECT
    hc.id AS holidayCampId,
    hv.name AS venueName,
    IFNULL(SUM(hbp.amount), 0) AS revenue
  FROM holiday_camp hc
  JOIN holiday_booking hb ON hb.holidayCampId = hc.id
  JOIN holiday_venues hv ON hv.id = hb.venueId
  LEFT JOIN holiday_booking_payments hbp 
    ON hbp.holiday_booking_id = hb.id
  WHERE hb.status = 'active'
AND hb.bookedBy IN(:allowed)
${sqlDateCondition}
  GROUP BY hc.id, hv.name
  ORDER BY hc.id
  `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: { allowed, ...sqlDateReplacements }
      }
    );

    // 2️⃣ Calculate total revenue across all venues
    const totalRevenues = revenuePerVenueRows.reduce((sum, r) => sum + Number(r.revenue || 0), 0);

    // 3️⃣ Map results into growth & revenue arrays
    const growth = [];
    const revenueData = [];

    revenuePerVenueRows.forEach(r => {
      const revenue = Number(r.revenue || 0);
      const growthPercent = totalRevenues > 0 ? Number(((revenue / totalRevenues) * 100).toFixed(2)) : 0;

      growth.push({
        holidayCampId: r.holidayCampId,
        venueName: r.venueName,
        growthPercent: growthPercent > 100 ? 100 : growthPercent
      });

      revenueData.push({
        holidayCampId: r.holidayCampId,
        venueName: r.venueName,
        revenue,
        revenueAverage,
      });
    });

    // 4️⃣ Final object for report
    const registration_perCamp_growth_and_venue = {
      growth,
      revenue: revenueData
    };

    // Debug log
    console.log(registration_perCamp_growth_and_venue);

    // ----------------------------
    // EARLY BIRD OFFER (DERIVED)
    // ----------------------------

    const EARLY_BIRD_DAYS = 14;

    // 1️⃣ Early bird bookings THIS YEAR
    const earlyBirdBookingsThisYearRow = await sequelize.query(
      `
SELECT COUNT(DISTINCT hb.id) AS count
FROM holiday_booking hb
JOIN (
  SELECT holidayCampId, MIN(startDate) AS firstStartDate
  FROM holiday_camp_dates
  WHERE startDate IS NOT NULL
  GROUP BY holidayCampId
) hcd ON hcd.holidayCampId = hb.holidayCampId
WHERE hb.status = 'active'
  AND hb.bookedBy IN(:allowed)
  AND hb.createdAt BETWEEN :startDate AND :endDate
  AND DATEDIFF(hcd.firstStartDate, hb.createdAt) >= :days
`,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          startDate: startOfThisYear,
          endDate: endOfThisYear,
          days: EARLY_BIRD_DAYS
        }
      }
    );

    const earlyBirdBookingsThisYear = Number(
      earlyBirdBookingsThisYearRow?.[0]?.count || 0
    );

    // 2️⃣ Total bookings LAST YEAR
    const totalBookingsLastYearRow = await HolidayBooking.findOne({
      attributes: [[sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: {
        status: "active",
        bookedBy: { [Op.in]: allowed },
        createdAt: {
          [Op.between]: [startOfLastYear, endOfLastYear]
        }
      },
      raw: true
    });

    const totalBookingsLastYear = Number(
      totalBookingsLastYearRow?.count || 0
    );

    // 3️⃣ Total bookings THIS YEAR
    const totalBookingsThisYearRow = await HolidayBooking.findOne({
      attributes: [[sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: {
        status: "active",
        bookedBy: { [Op.in]: allowed },
        createdAt: {
          [Op.between]: [startOfThisYear, endOfThisYear]
        }
      },
      raw: true
    });

    const totalBookingsThisYear = Number(
      totalBookingsThisYearRow?.count || 0
    );

    // 4️⃣ Percent calculations
    const registrationsPercent =
      totalBookingsThisYear > 0
        ? Number(((earlyBirdBookingsThisYear / totalBookingsThisYear) * 100).toFixed(2))
        : 0;

    const percentage =
      totalBookingsThisYear > 0
        ? Number(((earlyBirdBookingsThisYear / totalBookingsThisYear) * 100).toFixed(2))
        : 0;

    // 5️⃣ Revenue impact (ACTIVE early bird)
    const revenueImpactRow = await sequelize.query(
      `
SELECT IFNULL(SUM(hbp.amount),0) AS revenue
FROM holiday_booking hb
JOIN (
  SELECT holidayCampId, MIN(startDate) AS firstStartDate
  FROM holiday_camp_dates
  WHERE startDate IS NOT NULL
  GROUP BY holidayCampId
) hcd ON hcd.holidayCampId = hb.holidayCampId
LEFT JOIN holiday_booking_payments hbp
  ON hbp.holiday_booking_id = hb.id
WHERE hb.status = 'active'
  AND hb.bookedBy IN(:allowed)
  AND hb.createdAt BETWEEN :startDate AND :endDate
  AND DATEDIFF(hcd.firstStartDate, hb.createdAt) >= :days
`,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          allowed,
          startDate: startOfThisYear,
          endDate: endOfThisYear,
          days: EARLY_BIRD_DAYS
        }
      }
    );

    const revenueImpact = Number(
      revenueImpactRow?.[0]?.revenue || 0
    );

    // ----------------------------
    // 9) ENROLLED STUDENTS + AGE + GENDER
    // ----------------------------
    const enrolledStudentsTotalRow = await HolidayBookingStudentMeta.findOne({
      attributes: [
        [sequelize.fn("COUNT", sequelize.col("HolidayBookingStudentMeta.id")), "total"]
      ],
      include: [
        {
          model: HolidayBooking,
          as: "holidayBooking",
          attributes: [],
          where: applyDateFilter({
            status: "active",
            ...whereBooking
          }),
        }
      ],
      raw: true,
    });

    const enrolledStudentsTotal = Number(enrolledStudentsTotalRow?.total || 0);

    // AGE GROUPS
    const ageBuckets = [
      { key: "0-4", min: 0, max: 4 },
      { key: "5-7", min: 5, max: 7 },
      { key: "8-10", min: 8, max: 10 },
      { key: "11+", min: 11, max: 200 },
    ];

    const ageBucketCounts = {};

    for (const bucket of ageBuckets) {
      const whereAge = {
        age: { [Op.gte]: bucket.min },
      };
      if (bucket.max < 200) whereAge.age[Op.lte] = bucket.max;

      const row = await HolidayBookingStudentMeta.findOne({
        attributes: [
          [sequelize.fn("COUNT", sequelize.col("HolidayBookingStudentMeta.id")), "count"]
        ],
        where: whereAge,
        include: [
          {
            model: HolidayBooking,
            as: "holidayBooking",
            attributes: [],
            where: applyDateFilter({
              ...whereBooking
            }),
            required: true
          }
        ],
        raw: true,
      });

      const count = Number(row?.count || 0);
      ageBucketCounts[bucket.key] = {
        total: count,
        percentage:
          enrolledStudentsTotal > 0
            ? Number(((count / enrolledStudentsTotal) * 100).toFixed(2))
            : 0,
      };
    }

    // GENDER
    const genders = await HolidayBookingStudentMeta.findAll({
      attributes: [
        "gender",
        [sequelize.fn("COUNT", sequelize.col("HolidayBookingStudentMeta.id")), "count"]
      ],
      include: [
        {
          model: HolidayBooking,
          as: "holidayBooking",
          attributes: [],
          where: applyDateFilter({
            status: "active",
            ...whereBooking
          }),
          required: true
        }
      ],
      group: ["gender"],
      raw: true,
    });

    const genderCounts = genders.reduce((acc, r) => {
      acc[r.gender || "unknown"] = {
        total: Number(r.count || 0),
        percentage:
          enrolledStudentsTotal > 0
            ? Number(((Number(r.count) / enrolledStudentsTotal) * 100).toFixed(2))
            : 0,
      };
      return acc;
    }, {});

    // ----------------------------
    // 10) MARKETING CHANNEL PERFORMANCE
    // ----------------------------
    const marketingRows = await HolidayBooking.findAll({
      attributes: ["marketingChannel", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: applyDateFilter({
        ...whereBooking
      }),
      group: ["marketingChannel"],
      raw: true,
    });
    // Sum total bookings dynamically
    const totalBookingsForMarketing = marketingRows.reduce(
      (sum, r) => sum + Number(r.count || 0),
      0
    );

    // Map dynamic channels with counts
    const marketChannelPerformance = marketingRows.map(r => {
      const count = Number(r.count || 0);
      return {
        name: r.marketingChannel || "unknown",
        count,
        percentage:
          totalBookingsForMarketing > 0
            ? Number(((count / totalBookingsForMarketing) * 100).toFixed(2))
            : 0,
      };
    });

    // ----------------------------
    // 11) TOP AGENTS
    // ----------------------------
    // ----------------------------
    // 11) TOP AGENTS
    // ----------------------------
    const topAgentsRows = await HolidayBooking.findAll({
      attributes: ["bookedBy", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: applyDateFilter({
        ...whereBooking
      }),
      group: ["bookedBy"],
      order: [[sequelize.literal("count"), "DESC"]],
      limit: 10,
      raw: true,
    });

    const agentIds = topAgentsRows.map(r => r.bookedBy).filter(Boolean);

    const admins = await Admin.findAll({
      where: { id: { [Op.in]: agentIds } },
      attributes: ["id", "firstName", "lastName", "profile"],
      raw: true,
    });

    const adminMap = admins.reduce((acc, a) => {
      acc[a.id] = a;
      return acc;
    }, {});

    // Total leads for normalization
    const totalLeads = topAgentsRows.reduce((sum, r) => sum + Number(r.count || 0), 0);

    // Map agents with percentage normalized
    let sumPercentAgents = 0;
    const topAgents = topAgentsRows.map((r, i) => {
      const admin = adminMap[r.bookedBy];
      const count = Number(r.count || 0);
      let percentage = totalLeads > 0 ? Number(((count / totalLeads) * 100).toFixed(2)) : 0;

      // Adjust last agent to make total 100
      if (i === topAgentsRows.length - 1) {
        percentage = Number((100 - sumPercentAgents).toFixed(2));
      } else {
        sumPercentAgents += percentage;
      }

      return {
        createdBy: r.bookedBy,
        leadCount: count,
        percentage, // normalized
        creator: {
          id: admin?.id || null,
          firstName: admin?.firstName || null,
          lastName: admin?.lastName || null,
          profile: admin?.profile || null,
        },
      };
    });

    //----------------------------------------------------
    // FINAL REPORT
    //----------------------------------------------------
    return {
      success: true,
      data: {
        // ---------- TOP CARDS ----------
        summary: {
          totalRevenue: {
            thisYear: revenueThisYear,
            lastYear: revenueLastYear,
            average: revenueAverage,
          },
          averageRevenuePerCamp: {
            thisYear: avgRevenuePerCampThisYear,
            lastYear: avgRevenuePerCampLastYear,
            average: avgRevenuePerCampGrowthPercent,
          },
          revenueGrowth,
          averageAgeOfChild: {
            thisYear: averageAgeThisYear,  // use correct variable
            lastYear: averageAgeLastYear,  // use correct variable
          },
        },

        // ---------- MONTHLY STUDENTS ----------
        monthlyStudents: {
          thisYear: monthlyStudentsThisYear,
          lastYear: monthlyStudentsLastYear,
        },

        // ---------- MARKETING CHANNEL PERFORMANCE ----------
        marketChannelPerformance: (() => {
          const total = marketingRows.reduce((sum, r) => sum + Number(r.count || 0), 0);
          const channels = marketingRows.map(r => ({
            name: r.marketingChannel || "unknown",
            count: Number(r.count || 0),
            percentage:
              total > 0 ? Number(((Number(r.count) / total) * 100).toFixed(2)) : 0,
          }));

          // Adjust last channel to make sum exactly 100
          let sumPercent = 0;
          channels.forEach((c, i) => {
            if (i === channels.length - 1) {
              c.percentage = Number((100 - sumPercent).toFixed(2));
            } else {
              sumPercent += c.percentage;
            }
          });

          return channels;
        })(),
        // ---------- TOP AGENTS ----------
        topAgents: topAgents,

        // ---------- CAMPS REGISTRATION ----------
        // campsRegistration: campsRegistration,
        // ---------- CAMP GROWTH ----------

        registration_perCamp_growth_and_venue,

        // ---------- ENROLLED STUDENTS ----------
        enrolledStudents: {
          total: enrolledStudentsTotal,
          byAge: ageBucketCounts,
          byGender: genderCounts,
        },
        earlyBirdOffer: {
          registrationsPercent,
          percentage,
          revenueImpact
        },
      }
    };
  } catch (error) {
    console.error("❌ holidayCampsReports error:", error);
    return { success: false, message: error.message };
  }
};

// ✅ Get All Discounts with Usage Count
exports.getAllDiscounts = async () => {
  try {
    const now = new Date();

    const discounts = await Discount.findAll({
      where: {
        startDatetime: { [Op.lte]: now },

        // ⛔ exclude expired by date
        [Op.or]: [
          { endDatetime: { [Op.gte]: now } },
          { endDatetime: null },
        ],
      },

      order: [["createdAt", "DESC"]],

      include: [
        {
          model: DiscountAppliesTo,
          as: "appliesTo",
          attributes: ["id", "target"],
          where: {
            target: "holiday_camp", // ✅ FILTER
          },
          required: true, // INNER JOIN
        },
        {
          model: DiscountUsage,
          as: "usages",
          attributes: [],
          required: false,
        },
      ],

      attributes: {
        include: [[fn("COUNT", col("usages.id")), "usageCount"]],
      },

      // ⛔ exclude discounts that exceeded usage limit
      having: literal(`
        limitTotalUses IS NULL
        OR COUNT(usages.id) < limitTotalUses
      `),

      group: ["Discount.id", "appliesTo.id"],
    });

    return {
      status: true,
      message: "Active holiday camp discounts fetched successfully.",
      data: discounts,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllDiscounts:", error);
    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Error occurred while fetching discounts.",
    };
  }
};
