const {
  CancelSession,
  ClassSchedule,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingPayment,
  PaymentPlan,
  Credits,
  Admin,
  EmailConfig,
  Term,
  SessionPlanGroup,
  Venue,
  ClassScheduleTermMap,
} = require("../../../models");
const { Op } = require("sequelize");
const sendEmail = require("../../../utils/email/sendEmail");
const { cancelContract, } = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const { cancelGoCardlessBillingRequest, cancelBankMembership } = require("../../../utils/payment/pay360/customer");

exports.createCancellationRecord = async (
  classScheduleId,
  cancelData,
  adminId
) => {
  try {
    const targetMapId = cancelData.mapId; // ✅ expect ClassScheduleTermMap id
    console.log("🎯 Cancelling ClassScheduleTermMap id:", targetMapId);

    // Step 1: Fetch class schedule with venue
    const classSchedule = await ClassSchedule.findByPk(classScheduleId, {
      include: [{ model: Venue, as: "venue" }],
    });
    if (!classSchedule) return { status: false, message: "Class not found." };

    // Step 2: Fetch bookings
    const bookings = await Booking.findAll({
      where: { classScheduleId },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [{ model: BookingParentMeta, as: "parents" }],
        },
      ],
    });

    let sessionPlanId = 0;
    // Step 4: Update only the target ClassScheduleTermMap
    if (targetMapId) {
      const mapEntry = await ClassScheduleTermMap.findByPk(targetMapId);

      if (mapEntry) {
        console.log(`mapEntry - `, mapEntry);
        sessionPlanId = mapEntry.sessionPlanId;
        await mapEntry.update({ status: "cancelled" });
        console.log("✔️ ClassScheduleTermMap cancelled:", mapEntry.id);
      } else {
        console.log("⚠️ No ClassScheduleTermMap found for id:", targetMapId);
      }
    } else {
      console.log("⚠️ No mapId provided in request");
    }

    console.log(`sessionPlanId - `, sessionPlanId);
    // Step 3: Save cancellation record (always)
    const cancelEntry = await CancelSession.create({
      classScheduleId,
      reasonForCancelling: cancelData.reasonForCancelling,
      notifyMembers: cancelData.notifyMembers,
      creditMembers: cancelData.creditMembers,
      notifyTrialists: cancelData.notifyTrialists,
      notifyCoaches: cancelData.notifyCoaches,
      notifications: cancelData.notifications,
      mapId: targetMapId,
      sessionPlanGroupId: sessionPlanId,
      createdBy: adminId,
      cancelledAt: new Date(),
    });

    // Step 5: If no bookings → skip emails
    if (!bookings.length) {
      return {
        status: true,
        message:
          "Cancellation saved & terms updated. No bookings, so no emails sent.",
        data: cancelEntry,
      };
    }

    // Step 6: Build recipients list
    let recipients = [];
    for (const booking of bookings) {
      for (const student of booking.students || []) {
        for (const parent of student.parents || []) {
          if (parent.parentEmail) {
            recipients.push({
              firstName: parent.parentFirstName,
              lastName: parent.parentLastName,
              email: parent.parentEmail,
            });
          }
        }
      }
    }

    // Step 7: Add admins matching parent emails
    const parentEmails = recipients.map((r) => r.email);
    const matchingAdmins = await Admin.findAll({
      where: { email: { [Op.in]: parentEmails }, status: "active" },
    });
    recipients.push(...matchingAdmins);

    // Step 8: Add cancelling admin
    const cancellingAdmin = await Admin.findOne({
      where: { id: adminId, status: "active" },
    });
    if (cancellingAdmin) {
      recipients.push({
        firstName: cancellingAdmin.firstName,
        lastName: cancellingAdmin.lastName,
        email: cancellingAdmin.email,
      });
    }

    // Step 9: Remove duplicates
    const uniqueRecipients = Array.from(
      new Map(recipients.map((r) => [r.email, r])).values()
    );

    // Step 10: Send emails
    const emailTemplate = await EmailConfig.findOne({
      where: { module: "cancel-class", action: "cancel", status: true },
    });

    if (cancelData.notifications?.length && emailTemplate) {
      const alreadySent = new Set();

      for (const recipient of uniqueRecipients) {
        if (alreadySent.has(recipient.email)) continue;

        const personalizedBody = emailTemplate.html_template
          .replace("{{firstName}}", recipient.firstName || "Member")
          .replace("{{className}}", classSchedule.className || "N/A")
          .replace("{{venueName}}", classSchedule.venue?.name || "Venue")
          .replace(
            "{{cancelReason}}",
            cancelData.reasonForCancelling || "Not specified"
          );

        const subjectLine =
          cancelData.notifications.find((n) => n.role === "Member")
            ?.subjectLine || emailTemplate.subject;

        const mailData = {
          recipient: [
            {
              name: `${recipient.firstName} ${recipient.lastName || ""}`.trim(),
              email: recipient.email,
            },
          ],
          subject: subjectLine,
          htmlBody: personalizedBody,
        };

        const config = {
          host: emailTemplate.smtp_host,
          port: emailTemplate.smtp_port,
          secure: !!emailTemplate.smtp_secure,
          username: emailTemplate.smtp_username,
          password: emailTemplate.smtp_password,
          from_email: emailTemplate.from_email,
          from_name: emailTemplate.from_name,
        };

        const emailResult = await sendEmail(config, mailData);
        if (emailResult.status) alreadySent.add(recipient.email);
      }
    }
    // --------------------------------------------------
    // STEP X: CREDIT MEMBERS IF ENABLED
    // --------------------------------------------------
    if (cancelData.creditMembers === "Yes" && bookings.length) {
      console.log("💳 Credit Members enabled — issuing credits");

      for (const booking of bookings) {
        // ❌ Skip non-membership bookings
        if (booking.bookingType !== "paid") continue;

        // ✅ NEW: Allow credits ONLY for active / frozen bookings
        if (!["active", "frozen"].includes(booking.status)) {
          console.log(
            `⏭️ Skipped credit — booking ${booking.id} status=${booking.status}`
          );
          continue;
        }

        const payment = await BookingPayment.findOne({
          where: { bookingId: booking.id },
        });

        if (!payment) {
          console.log(`⚠️ No payment found for booking ${booking.id}`);
          continue;
        }

        let creditAmount = 0;

        // -----------------------------
        // ACCESS PAY SUITE
        // -----------------------------
        if (payment.paymentType === "accesspaysuite") {
          if (!booking.paymentPlanId) {
            console.log(`⚠️ No paymentPlanId for booking ${booking.id}`);
            continue;
          }

          const plan = await PaymentPlan.findByPk(booking.paymentPlanId);

          if (!plan?.price) {
            console.log(`⚠️ PaymentPlan price missing for booking ${booking.id}`);
            continue;
          }

          creditAmount = plan.price;
        }

        // -----------------------------
        // BANK PAYMENT
        // -----------------------------
        else if (payment.paymentType === "bank") {
          let billingRequest = payment.goCardlessBillingRequest;

          if (typeof billingRequest === "string") {
            try {
              billingRequest = JSON.parse(billingRequest);
            } catch {
              billingRequest = null;
            }
          }

          creditAmount =
            billingRequest?.planPrice ||
            billingRequest?.amount ||
            0;
        }

        if (creditAmount <= 0) {
          console.log(`⚠️ Credit skipped — amount 0 for booking ${booking.id}`);
          continue;
        }

        // -----------------------------
        // CREATE OR UPDATE CREDIT
        // -----------------------------
        const [credit, created] = await Credits.findOrCreate({
          where: {
            bookingId: booking.id,
            reason: "class_cancel_credit",
          },
          defaults: {
            bookingId: booking.id,
            creditAmount,
            reason: "class_cancel_credit",
          },
        });

        if (!created) {
          await credit.update({
            creditAmount: credit.creditAmount + creditAmount,
          });
        }

        console.log(
          `✅ Credit issued: bookingId=${booking.id}, amount=${creditAmount}`
        );
      }
    }

    return {
      status: true,
      message: "Cancellation saved, terms updated & emails sent.",
      data: cancelEntry,
    };
  } catch (error) {
    return { status: false, message: error.message };
  }
};

// ✅ Get a single cancelled session by ID
exports.getCancelledSessionById = async (id) => {
  console.log(`🛠 Service: getCancelledSessionById called for id=${id}`);

  try {
    const session = await CancelSession.findByPk(id, {
      include: [
        {
          model: ClassSchedule,
          as: "classSchedule",
          include: [{ model: Venue, as: "venue" }],
        },
      ],
    });

    if (!session) {
      console.warn(`⚠️ No cancelled session found for id=${id}`);
      return { status: false, message: "Cancelled session not found." };
    }

    const json = session.toJSON();

    // Safely parse notifications
    let notificationsArray = [];
    if (Array.isArray(json.notifications)) {
      notificationsArray = json.notifications;
    } else if (typeof json.notifications === "string") {
      try {
        notificationsArray = JSON.parse(json.notifications);
      } catch {
        notificationsArray = [];
      }
    }

    const formattedData = {
      id: json.id,
      classScheduleId: json.classScheduleId,
      reasonForCancelling: json.reasonForCancelling,
      notifyMembers: json.notifyMembers,
      creditMembers: json.creditMembers,
      notifyTrialists: json.notifyTrialists,
      notifyCoaches: json.notifyCoaches,
      cancelledAt: json.cancelledAt,
      createdBy: json.createdBy,
      notifications: notificationsArray.map((n) => ({
        role: n.role,
        subjectLine: n.subjectLine,
        emailBody: n.emailBody,
        deliveryMethod: n.deliveryMethod,
        templateKey: n.templateKey,
      })),
      classSchedule: json.classSchedule || null,
    };

    return { status: true, data: formattedData };
  } catch (error) {
    console.error(`❌ getCancelledSessionById Error:`, error.message);
    return { status: false, message: error.message };
  }
};

exports.getCancelledSessionByMapIdSessionPlanId = async (mapId, sessionPlanGroupId) => {
  console.log(`🛠 Service: getCancelledSessionBySessionPlanId called for sessionPlanGroupId=${sessionPlanGroupId}`);

  try {
    // Validate inputs
    if (!mapId || !sessionPlanGroupId) {
      console.warn("⚠️ Both mapId and sessionPlanGroupId are required.");
      return { status: false, message: "Both mapId and sessionPlanGroupId are required." };
    }

    // ✅ Correct method: findOne with where condition
    const session = await CancelSession.findOne({
      where: { mapId, sessionPlanGroupId },
      include: [
        {
          model: ClassSchedule,
          as: "classSchedule",
          include: [{ model: Venue, as: "venue" }],
        },
      ],
    });

    if (!session) {
      console.warn(`⚠️ No cancelled session found for sessionPlanGroupId=${sessionPlanGroupId}`);
      return { status: false, message: "Cancelled session not found." };
    }

    const json = session.toJSON();

    // Safely parse notifications
    let notificationsArray = [];
    if (Array.isArray(json.notifications)) {
      notificationsArray = json.notifications;
    } else if (typeof json.notifications === "string") {
      try {
        notificationsArray = JSON.parse(json.notifications);
      } catch {
        notificationsArray = [];
      }
    }

    const formattedData = {
      id: json.id,
      classScheduleId: json.classScheduleId,
      reasonForCancelling: json.reasonForCancelling,
      notifyMembers: json.notifyMembers,
      creditMembers: json.creditMembers,
      notifyTrialists: json.notifyTrialists,
      notifyCoaches: json.notifyCoaches,
      cancelledAt: json.cancelledAt,
      createdBy: json.createdBy,
      notifications: notificationsArray.map((n) => ({
        role: n.role,
        subjectLine: n.subjectLine,
        emailBody: n.emailBody,
        deliveryMethod: n.deliveryMethod,
        templateKey: n.templateKey,
      })),
      classSchedule: json.classSchedule || null,
    };

    return { status: true, data: formattedData };
  } catch (error) {
    console.error(`❌ getCancelledSessionBySessionPlanId Error:`, error.message);
    return { status: false, message: error.message };
  }
};
