// const { NoMembershipTrial, Booking } = require("../../../models");
const {
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  Venue,
  ClassSchedule,
  CancelBooking,
} = require("../../../models");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");

// Create record
exports.createNoMembershipTrial = async ({
  bookingId,
  noMembershipReason,
  noMembershipNotes,
}) => {
  try {
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found." };
    }

    if (booking.status !== "active") {
      return { status: false, message: "Booking is not marked as active." };
    }

    const existing = await CancelBooking.findOne({ where: { bookingId } });
    if (existing) {
      return {
        status: false,
        message: "Record already exists for this booking.",
      };
    }

    // ✅ Create no membership record (fixed bookingType = "free")
    const record = await CancelBooking.create({
      bookingId,
      bookingType: "free_trial", // fixed value
      noMembershipReason: noMembershipReason || null,
      noMembershipNotes: noMembershipNotes || null,
    });

    // ✅ Update booking status
    // await booking.update({ status: "active" });

    return { status: true, data: record };
  } catch (error) {
    console.error("❌ createNoMembershipTrial Error:", error);
    return { status: false, message: error.message };
  }
};

// ✅ Get all No Membership trials
exports.getNoMembershipTrials = async () => {
  try {
    const records = await CancelBooking.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          attributes: [
            "id",
            "venueId",
            "classScheduleId",
            "trialDate",
            "status",
            "bookedBy",
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // ✅ Remove null or empty-string fields
    const cleanedRecords = records.map((record) => {
      const plain = record.get({ plain: true });
      const cleaned = {};

      Object.entries(plain).forEach(([key, value]) => {
        if (
          value !== null &&
          value !== "" &&
          !(typeof value === "object" && Object.keys(value).length === 0)
        ) {
          cleaned[key] = value;
        }
      });

      return cleaned;
    });

    return {
      status: true,
      message: "No membership trials fetched successfully.",
      data: cleanedRecords,
    };
  } catch (error) {
    console.error("❌ getNoMembershipTrials Error:", error);
    return { status: false, message: error.message };
  }
};

exports.sendNoMembershipEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Get booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Get no membership trial info
    const noMembership = await CancelBooking.findOne({
      where: { bookingId },
    });
    if (!noMembership) {
      return {
        status: false,
        message: "No membership record found for this booking",
      };
    }

    // 3️⃣ Get students in the booking
    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });
    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 4️⃣ Venue & Class info
    const venue = await Venue.findByPk(booking.venueId);
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

    const venueName = venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const startTime = classSchedule?.startTime || "TBA";
    const endTime = classSchedule?.endTime || "TBA";
    const trialDate = booking.trialDate;
    const reason = noMembership.noMembershipReason || "No reason provided";
    const notes = noMembership.noMembershipNotes || "";

    // 5️⃣ Get email template config
    const emailConfigResult = await getEmailConfig(
      "admin",
      "no-membership-trial"
    );
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 6️⃣ Loop through students
    for (const student of studentMetas) {
      const parents = await BookingParentMeta.findAll({
        where: { studentId: student.id },
      });

      if (!parents.length) continue;

      // 7️⃣ Send email to all parents for the student
      for (const parent of parents) {
        if (!parent?.parentEmail) continue;

        let notesHtml = "";
        if (notes.trim() !== "") {
          notesHtml = `<p><strong>Additional Notes:</strong> ${notes}</p>`;
        }

        let finalHtml = htmlTemplate
          .replace(/{{parentName}}/g, parent.parentFirstName)
          .replace(/{{studentName}}/g, student.studentFirstName)
          .replace(/{{venueName}}/g, venueName)
          .replace(/{{className}}/g, className)
          .replace(/{{startTime}}/g, startTime)
          .replace(/{{endTime}}/g, endTime)
          .replace(/{{trialDate}}/g, trialDate)
          .replace(/{{reason}}/g, reason)
          .replace(/{{notesSection}}/g, notesHtml)
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
      message: `No Membership Trial emails sent to ${sentTo.length} parents`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendNoMembershipEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};
