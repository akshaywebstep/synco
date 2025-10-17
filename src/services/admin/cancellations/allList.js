const {
  CancelBooking,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  PaymentPlan,
  ClassSchedule,
  Venue,
  Admin,
} = require("../../../models");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const { Op } = require("sequelize");
// 🔹 Utility to calculate trend %
function getTrend(current, previous) {
  current = Number(current) || 0; // Ensure current is a number
  previous = Number(previous) || 0; // Ensure previous is a number

  if (previous === 0) return "0.0";
  return (((current - previous) / previous) * 100).toFixed(1);
}

// 🔹 Helper to calculate stats from records
function calcStats(records) {
  // Total Requests
  const totalRequests = records.length;

  // Avg Tenure
  const tenures = records
    .map((b) => {
      if (!b.startDate || !b.cancelDate) return null;
      const start = new Date(b.startDate);
      const end = new Date(b.cancelDate);
      const months =
        (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth());
      return months > 0 ? months : 0;
    })
    .filter(Boolean);
  const avgTenure = tenures.length
    ? tenures.reduce((a, b) => a + b, 0) / tenures.length
    : 0;

  // Most Requested Venue
  const byVenue = records.reduce((acc, b) => {
    const v = b.venue?.name || "";
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
  const mostRequestedVenue = Object.entries(byVenue).sort(
    (a, b) => b[1] - a[1]
  )[0] || ["", 0];

  // Common Reason
  const byReason = records.reduce((acc, b) => {
    const r = b.cancelReason || "";
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});
  const commonReason = Object.entries(byReason).sort(
    (a, b) => b[1] - a[1]
  )[0] || ["", 0];

  // Highest Risk Age Group
  const byAgeGroup = records.reduce((acc, b) => {
    b.students?.forEach((s) => {
      const age = s.age;
      if (!age) return;
      const group =
        age <= 6
          ? "0-6"
          : age <= 10
            ? "7-10"
            : age <= 14
              ? "11-14"
              : age <= 18
                ? "15-18"
                : "18+";
      acc[group] = (acc[group] || 0) + 1;
    });
    return acc;
  }, {});
  const highestRisk = Object.entries(byAgeGroup).sort(
    (a, b) => b[1] - a[1]
  )[0] || ["", 0];

  return {
    totalRequests,
    avgTenure,
    mostRequestedVenue,
    commonReason,
    highestRisk,
  };
}

exports.getFullCancelBooking = async ({
  bookingType,
  cancellationType,
  venueName,
  studentName,
  fromDate,
  toDate,
  status,
  bookedBy
}) => {
  try {
    // Build where clause
    const whereClause = { bookingType: "membership" };

    if (cancellationType) {
      // If a specific type is passed, filter by it
      whereClause.cancellationType = cancellationType;
    } else {
      // Otherwise include both immediate and scheduled
      whereClause.cancellationType = {
        [Op.in]: ["immediate", "scheduled"],
      };
    }

    if (cancellationType) whereClause.cancellationType = cancellationType;

    if (fromDate && toDate) {
      whereClause.createdAt = {
        [Op.between]: [new Date(fromDate), new Date(toDate)],
      };
    } else if (fromDate) {
      whereClause.createdAt = { [Op.gte]: new Date(fromDate) };
    } else if (toDate) {
      whereClause.createdAt = { [Op.lte]: new Date(toDate) };
    }

    let cancellationIds = [];

    if (bookedBy) {
      const cancellations = await Booking.findAll({
        where: {
          bookedBy,
          status: {
            [Op.in]: ['request_to_cancel', 'canceled']
          }
        },
        attributes: ['id'], // only fetch the ID column
        raw: true
      });

      // Extract the IDs into a plain array
      cancellationIds = cancellations.map(c => c.id);
    }

    // Only add bookingId condition if there are IDs
    if (cancellationIds.length > 0) {
      whereClause.bookingId = { [Op.in]: cancellationIds };
    }

    // Define previous period (for trends)
    let prevFrom = null;
    let prevTo = null;
    if (fromDate && toDate) {
      const currentFrom = new Date(fromDate);
      const currentTo = new Date(toDate);
      const diffDays = Math.ceil(
        (currentTo - currentFrom) / (1000 * 60 * 60 * 24)
      );
      prevFrom = new Date(currentFrom);
      prevFrom.setDate(prevFrom.getDate() - diffDays);
      prevTo = new Date(currentFrom);
      prevTo.setDate(prevTo.getDate() - 1);
    }

    // Fetch current cancellations
    const cancellations = await CancelBooking.findAll({
      where: whereClause,
      attributes: [
        "id",
        "bookingId",
        "cancelReason",
        "cancelDate",
        "cancellationType",
        "additionalNote",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: Booking,
          as: "booking",
          where: status ? { status } : undefined, // ✅ filter by booking status

          attributes: [
            "id",
            "venueId",
            "classScheduleId",
            "status",
            "bookedBy",
            "startDate",
            "bookingType",
            "totalStudents",
            // "keyInformation",
            "paymentPlanId",
          ],
          include: [
            { model: Venue, as: "venue", required: false },
            { model: PaymentPlan, as: "paymentPlan", required: false },
            {
              model: BookingStudentMeta,
              as: "students",
              attributes: [
                "id",
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "age",
                "gender",
                "medicalInformation",
              ],
              include: [
                { model: BookingParentMeta, as: "parents", required: false },
                {
                  model: BookingEmergencyMeta,
                  as: "emergencyContacts",
                  required: false,
                },
              ],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Parse current data
    let parsed = cancellations
      .map((cancel) => {
        const booking = cancel.booking;
        if (!booking) return null;

        const students =
          booking.students?.map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          })) || [];

        const parents =
          booking.students?.flatMap((s) =>
            (s.parents || []).map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            }))
          ) || [];

        const emergency =
          booking.students?.flatMap((s) =>
            (s.emergencyContacts || []).map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
          )?.[0] || null;

        return {
          cancellationId: cancel.id,
          bookingId: cancel.bookingId,
          cancelReason: cancel.cancelReason,
          cancelDate: cancel.cancelDate,
          cancellationType: cancel.cancellationType,
          additionalNote: cancel.additionalNote,
          createdAt: cancel.createdAt,
          updatedAt: cancel.updatedAt,

          venueId: booking.venueId,
          venue: booking.venue || null,
          classScheduleId: booking.classScheduleId,
          startDate: booking.startDate,
          totalStudents: booking.totalStudents,
          // keyInformation: booking.keyInformation,
          paymentPlan: booking.paymentPlan || null,
          status: booking.status,

          students,
          parents,
          emergency,
        };
      })
      .filter(Boolean);

    // Apply filters
    if (venueName) {
      parsed = parsed.filter((item) =>
        item.venue?.name?.toLowerCase().includes(venueName.toLowerCase())
      );
    }
    if (studentName) {
      parsed = parsed.filter((item) =>
        item.students?.some((s) =>
          `${s.studentFirstName || ""} ${s.studentLastName || ""}`
            .toLowerCase()
            .includes(studentName.toLowerCase())
        )
      );
    }

    // Fetch previous cancellations if date filter applied
    let prevParsed = [];
    if (prevFrom && prevTo) {
      const prevCancellations = await CancelBooking.findAll({
        where: { bookingType, createdAt: { [Op.between]: [prevFrom, prevTo] } },
        include: [
          {
            model: Booking,
            as: "booking",
            include: [{ model: Venue, as: "venue" }],
          },
        ],
      });
      prevParsed = prevCancellations.map((c) => ({
        cancelReason: c.cancelReason,
        cancelDate: c.cancelDate,
        venue: c.booking?.venue || null,
        startDate: c.booking?.startDate,
        students: c.booking?.students || [],
      }));
    }

    // Stats calculation
    const currentStats = calcStats(parsed);
    const previousStats = calcStats(prevParsed);

    const stats = {
      totalRequests: {
        value: [currentStats.totalRequests], // wrapped in array
        change: `${getTrend(
          currentStats.totalRequests,
          previousStats.totalRequests
        )}%`,
      },
      avgTenure: {
        value: [currentStats.avgTenure.toFixed(1)], // wrapped in array
        change: `${getTrend(currentStats.avgTenure, previousStats.avgTenure)}%`,
      },
      mostRequestedVenue: {
        value: [currentStats.mostRequestedVenue?.[0] || "N/A"], // array with label only
        change: `${getTrend(
          currentStats.mostRequestedVenue?.[1] || 0,
          previousStats.mostRequestedVenue?.[1] || 0
        )}%`,
      },
      commonReason: {
        value: [currentStats.commonReason?.[0] || "N/A"], // array with reason only
        change: `${getTrend(
          currentStats.commonReason?.[1] || 0,
          previousStats.commonReason?.[1] || 0
        )}%`,
      },
      highestRiskAgeGroup: {
        value: [currentStats.highestRisk?.[0] || "N/A"], // array with group only
        change: `${getTrend(
          currentStats.highestRisk?.[1] || 0,
          previousStats.highestRisk?.[1] || 0
        )}%`,
      },
    };

    // Unique venues
    const uniqueVenues = [
      ...new Map(parsed.map((p) => [p.venue?.id, p.venue])).values(),
    ];

    return {
      status: true,
      data: {
        cancellationData: parsed,
        allVenue: uniqueVenues,
        stats,
      },
    };
  } catch (error) {
    console.error("❌ getFullCancelBooking Error:", error);
    return {
      status: false,
      message: error.message,
      data: { cancellationData: [], allVenue: [], stats: {} },
    };
  }
};

exports.sendCancelBookingEmailToParents = async ({ bookingIds }) => {
  try {
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return { status: false, message: "No bookingIds provided" };
    }

    let totalSent = 0;
    let allSentTo = [];
    let errors = [];

    for (const bookingId of bookingIds) {
      try {
        // 1️⃣ Find cancellation record + booking
        const cancelBooking = await CancelBooking.findOne({
          where: { bookingId },
          include: [
            {
              model: Booking,
              as: "booking",
              include: [
                { model: Venue, as: "venue", required: false },
                {
                  model: ClassSchedule,
                  as: "classSchedule",
                  required: false,
                },
                {
                  model: BookingStudentMeta,
                  as: "students",
                  include: [
                    {
                      model: BookingParentMeta,
                      as: "parents",
                      required: false,
                    },
                  ],
                },
              ],
            },
          ],
        });

        if (!cancelBooking || !cancelBooking.booking) {
          errors.push({
            bookingId,
            error: "Booking or cancellation not found",
          });
          continue;
        }

        const booking = cancelBooking.booking;
        const venueName = booking.venue?.name || "Unknown Venue";
        const className = booking.classSchedule?.className || "Unknown Class";
        const startTime = booking.classSchedule?.startTime || "TBA";
        const endTime = booking.classSchedule?.endTime || "TBA";
        const startDate = booking.startDate || "TBA";

        const cancelReason = cancelBooking.cancelReason || "Not specified";
        const additionalNote = cancelBooking.additionalNote || "";

        // 2️⃣ Email config
        const emailConfigResult = await getEmailConfig(
          "admin",
          "cancel-booking"
        );
        if (!emailConfigResult.status) {
          errors.push({ bookingId, error: "Email config missing" });
          continue;
        }

        const { emailConfig, htmlTemplate, subject } = emailConfigResult;

        // 3️⃣ Loop through students + parents
        for (const student of booking.students || []) {
          for (const parent of student.parents || []) {
            if (!parent?.parentEmail) continue;

            let noteHtml = "";
            if (additionalNote.trim() !== "") {
              noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
            }

            const finalHtml = htmlTemplate
              .replace(/{{parentName}}/g, parent.parentFirstName || "")
              .replace(/{{studentName}}/g, student.studentFirstName || "")
              .replace(/{{venueName}}/g, venueName)
              .replace(/{{className}}/g, className)
              .replace(/{{startTime}}/g, startTime)
              .replace(/{{endTime}}/g, endTime)
              .replace(/{{startDate}}/g, startDate)
              .replace(/{{cancelReason}}/g, cancelReason)
              .replace(/{{additionalNote}}/g, noteHtml)
              .replace(/{{appName}}/g, "Synco")
              .replace(/{{year}}/g, new Date().getFullYear());

            const recipient = [
              {
                name: `${parent.parentFirstName} ${parent.parentLastName}`.trim(),
                email: parent.parentEmail,
              },
            ];

            const sendResult = await sendEmail(emailConfig, {
              recipient,
              subject,
              htmlBody: finalHtml,
            });

            if (sendResult.status) {
              totalSent++;
              allSentTo.push(parent.parentEmail);
            }
          }
        }
      } catch (err) {
        console.error(`❌ Error processing bookingId ${bookingId}:`, err);
        errors.push({ bookingId, error: err.message });
      }
    }

    return {
      status: true,
      message: `Cancel booking emails sent to ${totalSent} parents`,
      sentTo: allSentTo,
      errors,
    };
  } catch (error) {
    console.error("❌ sendCancelBookingEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getFullCancelBookingById = async (id, adminId) => {
  try {
    const booking = await Booking.findOne({
      where: { id, bookingType: "paid" },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: false,
          attributes: [
            "id",
            "studentFirstName",
            "studentLastName",
            "dateOfBirth",
            "age",
            "gender",
            "medicalInformation",
          ],
          include: [
            {
              model: BookingParentMeta,
              as: "parents",
              required: false,
              attributes: [
                "id",
                "parentFirstName",
                "parentLastName",
                "parentEmail",
                "parentPhoneNumber",
                "relationToChild",
                "howDidYouHear",
              ],
            },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
              attributes: [
                "id",
                "emergencyFirstName",
                "emergencyLastName",
                "emergencyPhoneNumber",
                "emergencyRelation",
              ],
            },
          ],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          include: [{ model: Venue, as: "venue", required: false }],
        },
        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
            "profile",
          ],
          required: false,
        },
        {
          model: PaymentPlan,
          as: "paymentPlan",
          required: false,
        },
        {
          model: CancelBooking, // ✅ include cancel info
          as: "cancelData",
          required: false,
        },
      ],
    });

    if (!booking) {
      return { status: false, message: "Booking not found or not authorized." };
    }

    // --- Extract students ---
    const students =
      booking.students?.map((s) => ({
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    // --- Extract parents ---
    const parents =
      booking.students?.flatMap((s) =>
        (s.parents || []).map((p) => ({
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        }))
      ) || [];

    // --- Extract first emergency contact ---
    const emergency =
      booking.students?.flatMap((s) =>
        (s.emergencyContacts || []).map((e) => ({
          emergencyFirstName: e.emergencyFirstName,
          emergencyLastName: e.emergencyLastName,
          emergencyPhoneNumber: e.emergencyPhoneNumber,
          emergencyRelation: e.emergencyRelation,
        }))
      )?.[0] || null;

    // --- Extract cancel data ---
    const cancelData = booking.cancelData || null;

    // ✅ extract venueId from this booking
    const venueId = booking.classSchedule?.venue?.id || null;
    let newClasses = [];
    if (venueId) {
      // 🔎 find all other class schedules in the same venue
      newClasses = await ClassSchedule.findAll({
        where: { venueId },
      });
    }

    // Final response
    const response = {
      id: booking.id,
      bookingId: booking.bookingId,
      classScheduleId: booking.classScheduleId,
      startDate: booking.startDate,
      bookedBy: booking.bookedByAdmin || null,
      className: booking.className,
      classTime: booking.classTime,
      venueId: booking.venueId,
      venue: booking.classSchedule?.venue || null,
      status: booking.status,
      totalStudents: booking.totalStudents,
      source: booking.source,
      createdAt: booking.createdAt,

      students,
      parents,
      emergency,
      cancelData, // ✅ included

      classSchedule: booking.classSchedule || {},
      paymentPlan: booking.paymentPlan || null,
      newClasses,
    };

    return {
      status: true,
      message: "Fetched booking details successfully.",
      data: response,
    };
  } catch (error) {
    console.error("❌ getBookingById Error:", error.message);
    return { status: false, message: error.message };
  }
};
