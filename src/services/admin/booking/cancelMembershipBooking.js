const {
  CancelBooking,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  PaymentPlan,
  BookingPayment,  // You use it, but didn't import in snippet
  Credits,
  Venue,
  ClassSchedule,
} = require("../../../models");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const { cancelContract, } = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const { cancelGoCardlessBillingRequest, cancelBankMembership } = require("../../../utils/payment/pay360/customer");
const DEBUG = process.env.DEBUG === "true";

const { Op } = require("sequelize");

const { sequelize } = require("../../../models"); // import sequelize instance for transactions

exports.createCancelBooking = async ({
  bookingId,
  cancelReason,
  additionalNote,
  cancelDate = null,
  cancellationType: rawCancellationType,
}) => {
  const bookingType = "membership";

  DEBUG && console.log("🚀 Cancel membership started:", bookingId);

  const cancellationType =
    rawCancellationType ?? (cancelDate ? "scheduled" : "immediate");

  // Start transaction
  const t = await sequelize.transaction();

  try {
    const booking = await Booking.findByPk(bookingId, { transaction: t });
    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    // --------------------------------------------------
    // Payment cancellation and credit issuance
    // --------------------------------------------------

    const payment = await BookingPayment.findOne({ where: { bookingId }, transaction: t });

    let paymentCancelled = false;
    let creditAmountToIssue = 0;
    const paymentPlan = booking.paymentPlanId
      ? await PaymentPlan.findByPk(booking.paymentPlanId, { transaction: t })
      : null;

    if (!payment) {
      DEBUG && console.log("⚠️ No payment found → skipping gateway & credits");
      // You may decide what to do here: skip cancel or allow cancel without payment?
      await t.rollback();
      return { status: false, message: "No payment info found. Cannot proceed." };
    } else {
      DEBUG && console.log("💰 Payment type detected:", payment.paymentType);

      if (payment.paymentType === "accesspaysuite") {
        let gatewayResponse = payment.gatewayResponse;

        if (typeof gatewayResponse === "string") {
          gatewayResponse = JSON.parse(gatewayResponse);
        }

        const contractId = gatewayResponse?.contract?.Id;

        if (!contractId) {
          await t.rollback();
          return {
            status: false,
            message: "Missing AccessPaySuite contract ID",
          };
        }

        const apsResponse = await cancelContract(contractId, {
          reason: cancelReason || "Membership cancelled",
        });

        if (!apsResponse?.status) {
          await t.rollback();
          return { status: false, message: "Failed to cancel AccessPaySuite contract" };
        }

        paymentCancelled = true;

        await payment.update(
          { paymentStatus: "cancelled" },
          { transaction: t }
        );

        // ✅ FULL REFUND AS CREDIT 
        creditAmountToIssue = paymentPlan?.price || 0;

        DEBUG && console.log("💳 APS credit issued:", creditAmountToIssue);
      } else if (payment.paymentType === "bank") {
        let billingRequest = payment.goCardlessBillingRequest;

        if (typeof billingRequest === "string") {
          try {
            billingRequest = JSON.parse(billingRequest);
          } catch {
            billingRequest = null;
          }
        }

        DEBUG && console.log("🧾 Parsed GoCardless billing request:", billingRequest);

        if (!billingRequest?.id) {
          await t.rollback();
          return {
            status: false,
            message: "Missing GoCardless billing request ID",
          };
        }

        // Cancel the GoCardless billing request (this is the main cancellation step)
        const billingCancelRes = await cancelGoCardlessBillingRequest(billingRequest.id);

        if (!billingCancelRes?.status) {
          await t.rollback();
          return {
            status: false,
            message: "GoCardless billing request cancellation failed",
          };
        }

        paymentCancelled = true;
        await payment.update({ paymentStatus: "cancelled" }, { transaction: t });
        // Issue credits: prefer remainingCredits, fallback to planPrice from billing request
        creditAmountToIssue = booking.remainingCredits ?? billingRequest?.planPrice ?? 0;
      }

      else {
        await t.rollback();
        return { status: false, message: "Unsupported payment type" };
      }
    }

    // Issue credits only if payment cancelled
    if (!paymentCancelled) {
      await t.rollback();
      return { status: false, message: "Payment cancellation failed. Aborting." };
    }

    /// --------------------------------------------------
    // Always create/update Credits (0 allowed)
    // --------------------------------------------------

    const [creditRecord, created] = await Credits.findOrCreate({
      where: { bookingId },
      defaults: {
        bookingId,
        creditAmount: creditAmountToIssue || 0,
        reason:
          cancellationType === "immediate"
            ? "membership_cancel_immediate"
            : "membership_cancel_scheduled",
      },
      transaction: t,
    });

    if (!created) {
      await creditRecord.update(
        {
          creditAmount: creditAmountToIssue || 0,
          reason:
            cancellationType === "immediate"
              ? "membership_cancel_immediate"
              : "membership_cancel_scheduled",
        },
        { transaction: t }
      );
    }

    // --------------------------------------------------
    // Now create or update CancelBooking record
    // --------------------------------------------------

    const existingCancel = await CancelBooking.findOne({
      where: { bookingId, bookingType },
      transaction: t,
    });

    if (existingCancel) {
      await existingCancel.update(
        {
          cancelReason: cancelReason ?? existingCancel.cancelReason,
          additionalNote: additionalNote ?? existingCancel.additionalNote,
          cancelDate: cancelDate ?? existingCancel.cancelDate,
          cancellationType,
          updatedAt: new Date(),
        },
        { transaction: t }
      );
    } else {
      await CancelBooking.create(
        {
          bookingId,
          bookingType,
          cancelReason: cancelReason || null,
          additionalNote: additionalNote || null,
          cancelDate: cancelDate || null,
          cancellationType,
        },
        { transaction: t }
      );
    }

    // Update booking status
    if (cancellationType === "immediate") {
      await booking.update({ status: "cancelled" }, { transaction: t });

      // Restore class capacity
      const studentMetaList = await BookingStudentMeta.findAll({
        where: { bookingTrialId: bookingId },
        transaction: t,
      });

      if (studentMetaList.length && booking.classScheduleId) {
        const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId, {
          transaction: t,
        });
        if (classSchedule) {
          await classSchedule.update(
            {
              capacity: classSchedule.capacity + studentMetaList.length,
            },
            { transaction: t }
          );
        }
      }
    } else {
      await booking.update({ status: "request_to_cancel" }, { transaction: t });
    }

    // Commit transaction if all good
    await t.commit();

    return {
      status: true,
      message:
        cancellationType === "immediate"
          ? "Membership booking cancelled."
          : `Membership booking cancellation scheduled for ${cancelDate}.`,
    };
  } catch (error) {
    if (t) await t.rollback();
    console.error("❌ createCancelBooking Error:", error);
    return { status: false, message: error.message };
  }
};

exports.sendCancelBookingEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Get booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Get students in the booking
    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });

    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 3️⃣ Venue & Class info
    const venue = await Venue.findByPk(booking.venueId);
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

    const venueName = venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const startTime = classSchedule?.startTime || "TBA";
    const endTime = classSchedule?.endTime || "TBA";
    const trialDate = booking.trialDate;
    const additionalNote = booking.additionalNote || "";

    // 4️⃣ Email config
    const emailConfigResult = await getEmailConfig("admin", "cancel-trial");
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Loop over students
    for (const student of studentMetas) {
      const parents = await BookingParentMeta.findAll({
        where: { studentId: student.id },
      });

      if (!parents.length) continue;

      // Loop over ALL parents for this student
      for (const parent of parents) {
        if (!parent?.parentEmail) continue;

        let noteHtml = "";
        if (additionalNote.trim() !== "") {
          noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
        }

        let finalHtml = htmlTemplate
          .replace(/{{parentName}}/g, parent.parentFirstName)
          .replace(/{{studentName}}/g, student.studentFirstName)
          .replace(/{{venueName}}/g, venueName)
          .replace(/{{className}}/g, className)
          .replace(/{{startTime}}/g, startTime)
          .replace(/{{endTime}}/g, endTime)
          .replace(/{{trialDate}}/g, trialDate)
          .replace(/{{additionalNoteSection}}/g, noteHtml)
          .replace(/{{appName}}/g, "Synco")
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
    }

    return {
      status: true,
      message: `Cancel Free Trial emails sent to ${sentTo.length} parents`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendCancelBookingEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};
