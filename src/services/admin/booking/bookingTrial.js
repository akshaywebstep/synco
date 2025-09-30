const {
  sequelize,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  Venue,
  PaymentPlan,
  Admin,
} = require("../../../models");
const DEBUG = process.env.DEBUG === "true";

const { Op } = require("sequelize");
const bcrypt = require("bcrypt");

const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");

function generateBookingId(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();

  try {
    const adminId = options?.adminId;
    const source = options?.source;
    const leadId = options?.leadId || null;
    // const adminFirstName = options?.adminFirstName || "Unknown"; // still available for logs if needed

    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted leadId:", leadId);
    }

    if (source !== 'open' && !adminId) {
      throw new Error("Admin ID is required for bookedBy");
    }

    let bookedByAdminId = adminId || null;

    if (data.parents?.length > 0) {
      if (DEBUG) console.log("🔍 [DEBUG] Source is 'open'. Processing first parent...");

      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (DEBUG) console.log("🔍 [DEBUG] Extracted parent email:", email);

      if (!email) throw new Error("Parent email is required for open booking");

      const plainPassword = "Synco123";
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      if (DEBUG) console.log("🔍 [DEBUG] Generated hashed password for parent account");

      const [admin, created] = await Admin.findOrCreate({
        where: { email },
        defaults: {
          firstName: firstParent.parentFirstName || "Parent",
          lastName: firstParent.parentLastName || "",
          phoneNumber: firstParent.parentPhoneNumber || "",
          email,
          password: hashedPassword,
          roleId: 9, // parent role
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        transaction: t,
      });

      if (DEBUG) {
        console.log("🔍 [DEBUG] Admin account lookup completed.");
        console.log("🔍 [DEBUG] Was new admin created?:", created);
        console.log("🔍 [DEBUG] Admin record:", admin.toJSON ? admin.toJSON() : admin);
      }

      if (!created) {
        if (DEBUG) console.log("🔍 [DEBUG] Updating existing admin record with parent details");

        await admin.update(
          {
            firstName: firstParent.parentFirstName,
            lastName: firstParent.parentLastName,
            phoneNumber: firstParent.parentPhoneNumber || "",
          },
          { transaction: t }
        );
      }

      if (source === 'open') {
        bookedByAdminId = admin.id;
        if (DEBUG) console.log("🔍 [DEBUG] bookedByAdminId set to:", bookedByAdminId);
      }
    }

    // Step 1: Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        bookingId: generateBookingId(12), // random booking reference
        leadId,
        totalStudents: data.totalStudents,
        classScheduleId: data.classScheduleId,
        trialDate: data.trialDate,
        className: data.className,
        classTime: data.classTime,
        status: data.status || "pending",
        bookedBy: source === 'open' ? bookedByAdminId : adminId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t }
    );

    // Step 2: Create Students
    const studentIds = [];
    for (const student of data.students || []) {
      const studentMeta = await BookingStudentMeta.create(
        {
          bookingTrialId: booking.id,
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
      studentIds.push(studentMeta);
    }

    // Step 3: Create Parent Records
    if (data.parents && data.parents.length > 0 && studentIds.length > 0) {
      const firstStudent = studentIds[0];

      for (const [index, parent] of data.parents.entries()) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email || !emailRegex.test(email)) {
          throw new Error(`Invalid or missing parent email: ${email}`);
        }

        // Check duplicate email in BookingParentMeta
        const existingEmail = await BookingParentMeta.findOne({
          where: { parentEmail: email },
          transaction: t,
        });
        if (existingEmail) {
          throw new Error(`Parent with email ${email} already exists.`);
        }

        // Always create BookingParentMeta for each parent
        await BookingParentMeta.create(
          {
            studentId: firstStudent.id,
            parentFirstName: parent.parentFirstName,
            parentLastName: parent.parentLastName,
            parentEmail: email,
            parentPhoneNumber: parent.parentPhoneNumber,
            relationToChild: parent.relationToChild,
            howDidYouHear: parent.howDidYouHear,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );
      }
    }

    // Step 4: Emergency Contact
    if (
      data.emergency &&
      data.emergency.emergencyFirstName &&
      data.emergency.emergencyPhoneNumber &&
      studentIds.length > 0
    ) {
      const firstStudent = studentIds[0];
      await BookingEmergencyMeta.create(
        {
          studentId: firstStudent.id,
          emergencyFirstName: data.emergency.emergencyFirstName,
          emergencyLastName: data.emergency.emergencyLastName,
          emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
          emergencyRelation: data.emergency.emergencyRelation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
    }

    // Step 5: Update Class Capacity
    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId);
    const newCapacity = classSchedule.capacity - data.totalStudents;
    if (newCapacity < 0) throw new Error("Not enough capacity left.");
    await classSchedule.update({ capacity: newCapacity }, { transaction: t });

    // Step 6: Commit
    await t.commit();

    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentIds[0]?.id,
        studentFirstName: studentIds[0]?.studentFirstName,
        studentLastName: studentIds[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createBooking Error:", error);
    return { status: false, message: error.message };
  }
};

// Get all booking with bookingType = free
exports.getAllBookings = async (adminId, filters = {}) => {
  try {
    const trialWhere = {};
    const venueWhere = {};
    // const whereBooking = {};

    // Filter by bookingType = 'free' only
    trialWhere.bookingType = "free";

    if (filters.venueId) trialWhere.venueId = filters.venueId;
    if (filters.trialDate) trialWhere.trialDate = filters.trialDate;
    if (filters.status) trialWhere.status = filters.status;
    if (filters.bookedBy) {
      trialWhere.bookedBy = filters.bookedBy;
    }
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    }
    if (filters.venueName) {
      venueWhere.name = { [Op.like]: `%${filters.venueName}%` };
    }

    // 🔑 If you want to filter bookings only created by a specific admin:
    if (filters.bookedBy) {
      trialWhere.bookedBy = filters.bookedBy;
    }

    // ✅ Date filters
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateTrialFrom && filters.dateTrialTo) {
      const start = new Date(filters.dateTrialFrom + " 00:00:00");
      const end = new Date(filters.dateTrialTo + " 23:59:59");
      trialWhere.trialDate = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      trialWhere.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.lte]: end };
    }

    console.log("🔹 whereBooking:", trialWhere);

    const bookings = await Booking.findAll({
      order: [["id", "DESC"]],
      where: trialWhere,
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: !!filters.venueName, // ✅ make required if searching by venueName
          include: [
            {
              model: Venue,
              as: "venue",
              where: filters.venueName
                ? { name: { [Op.like]: `%${filters.venueName}%` } }
                : undefined,
              required: !!filters.venueName, // ✅ same here
            },
          ],
        },
        {
          model: Admin, // 👈 include bookedBy Admin
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
          ],
          required: false,
        },
      ],
    });

    const parsedBookings = await Promise.all(
      bookings.map(async (booking) => {
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
          booking.students?.[0]?.parents?.map((p) => ({
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || [];

        const emergency =
          booking.students?.[0]?.emergencyContacts?.map((e) => ({
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || [];

        let paymentPlans = [];
        const venue = booking?.classSchedule?.venue;
        if (venue) {
          let paymentPlanIds = [];
          if (typeof venue.paymentPlanId === "string") {
            try {
              paymentPlanIds = JSON.parse(venue.paymentPlanId);
            } catch { }
          } else if (Array.isArray(venue.paymentPlanId)) {
            paymentPlanIds = venue.paymentPlanId;
          }
          paymentPlanIds = paymentPlanIds
            .map((id) => parseInt(id, 10))
            .filter(Boolean);

          if (paymentPlanIds.length) {
            paymentPlans = await PaymentPlan.findAll({
              where: { id: paymentPlanIds },
            });
          }
        }

        const { venue: _venue, ...bookingData } = booking.dataValues;

        return {
          ...bookingData,
          students,
          parents,
          emergency,
          classSchedule: booking.classSchedule || null,
          paymentPlans,
          venue: booking.classSchedule?.venue || null, // ✅ include venue per trial
          ...(booking.bookedByAdmin
            ? {
              [booking.bookedByAdmin.role?.name === "Admin"
                ? "bookedByAdmin"
                : booking.bookedByAdmin.role?.name === "Agent"
                  ? "bookedByAgent"
                  : "bookedByOther"]: booking.bookedByAdmin,
            }
            : { bookedBy: null }),
        };
      })
    );

    // Filter by student name if needed
    let finalBookings = parsedBookings;
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase();
      finalBookings = parsedBookings.filter((booking) =>
        booking.students.some(
          (s) =>
            s.studentFirstName?.toLowerCase().includes(keyword) ||
            s.studentLastName?.toLowerCase().includes(keyword)
        )
      );
    }

    // Collect all venues used in trials
    const venueMap = {};
    finalBookings.forEach((b) => {
      if (b.venue) venueMap[b.venue.id] = b.venue;
    });
    const allVenues = Object.values(venueMap);
    const bookedByMap = {};

    finalBookings.forEach((b) => {
      if (b.venue) venueMap[b.venue.id] = b.venue;

      if (b.bookedByAdmin || b.bookedByAgent || b.bookedByOther) {
        const bookedBy = b.bookedByAdmin || b.bookedByAgent || b.bookedByOther;
        if (bookedBy?.id) bookedByMap[bookedBy.id] = bookedBy;
      }
    });
    const allBookedBy = Object.values(bookedByMap);

    // --- Helper to calculate percentage change ---
    const getPercentageChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // --- STATS CALCULATION SECTION ---

    // ✅ Current period stats
    const totalFreeTrials = finalBookings.length;
    const attendedCount = finalBookings.filter(
      (b) => b.status === "attended"
    ).length;
    const freeTrialAttendanceRate =
      totalFreeTrials > 0
        ? Math.round((attendedCount / totalFreeTrials) * 100)
        : 0;
    const trialsToMembers = finalBookings.filter(
      (b) => b.paymentPlans?.length > 0
    ).length;

    // ✅ Top Performer (Admin/Agent with most bookings)
    let topPerformer = null;
    if (allBookedBy.length > 0) {
      const countMap = {};
      finalBookings.forEach((b) => {
        const bookedBy = b.bookedByAdmin || b.bookedByAgent || b.bookedByOther;
        if (bookedBy?.id) {
          countMap[bookedBy.id] = (countMap[bookedBy.id] || 0) + 1;
        }
      });
      const topId = Object.keys(countMap).reduce((a, b) =>
        countMap[a] > countMap[b] ? a : b
      );
      topPerformer = allBookedBy.find((b) => b.id == topId);
    }

    // ✅ Previous period calculation (example: one month before same filters)
    let previousStats = { totalFreeTrials: 0, attended: 0, trialsToMembers: 0 };
    if (filters.trialDate) {
      const currentDate = new Date(filters.trialDate);
      const prevDate = new Date(currentDate);
      prevDate.setMonth(prevDate.getMonth() - 1);

      const prevBookings = await Booking.findAll({
        where: { ...trialWhere, trialDate: prevDate },
      });

      previousStats.totalFreeTrials = prevBookings.length;
      previousStats.attended = prevBookings.filter(
        (b) => b.status === "attended"
      ).length;
      previousStats.trialsToMembers = prevBookings.filter(
        (b) => b.paymentPlans?.length > 0
      ).length;
    }

    // ✅ Calculate percentage changes
    const stats = {
      totalFreeTrials: {
        value: totalFreeTrials,
        change: getPercentageChange(
          totalFreeTrials,
          previousStats.totalFreeTrials
        ),
      },
      freeTrialAttendanceRate: {
        value: freeTrialAttendanceRate,
        change: getPercentageChange(attendedCount, previousStats.attended),
      },
      trialsToMembers: {
        value: trialsToMembers,
        change: getPercentageChange(
          trialsToMembers,
          previousStats.trialsToMembers
        ),
      },
      topPerformer,
    };

    return {
      status: true,
      message: "Fetched free trial bookings successfully.",
      totalFreeTrials: finalBookings.length,
      data: {
        trials: finalBookings,
        venue: allVenues, // ✅ top-level array of all venues
        bookedByAdmin: allBookedBy,
        stats,
      },
    };
  } catch (error) {
    console.error("❌ getAllBookings Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getBookingById = async (id, adminId) => {
  try {
    const booking = await Booking.findOne({
      where: { id },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: false,
          include: [
            {
              model: BookingParentMeta,
              as: "parents",
              required: false,
            },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          include: [
            {
              model: Venue,
              as: "venue",
              required: false,
            },
          ],
        },
      ],
    });

    if (!booking) {
      return {
        status: false,
        message: "Booking not found or not authorized.",
      };
    }

    // Fetch payment plans
    let paymentPlans = [];
    const venue = booking?.classSchedule?.venue;
    if (venue) {
      let paymentPlanIds = [];

      if (typeof venue.paymentPlanId === "string") {
        try {
          paymentPlanIds = JSON.parse(venue.paymentPlanId);
        } catch {
          console.warn("⚠️ Failed to parse venue.paymentPlanId");
        }
      } else if (Array.isArray(venue.paymentPlanId)) {
        paymentPlanIds = venue.paymentPlanId;
      }

      paymentPlanIds = paymentPlanIds
        .map((id) => parseInt(id, 10))
        .filter(Boolean);

      if (paymentPlanIds.length) {
        paymentPlans = await PaymentPlan.findAll({
          where: { id: paymentPlanIds },
        });
      }
    }

    // Final Response — no .toJSON() and no field picking
    return {
      status: true,
      message: "Fetched booking details successfully.",
      data: {
        ...booking.dataValues, // includes all booking fields
        students: booking.students || [],
        classSchedule: booking.classSchedule || null, // full object
        paymentPlans,
      },
    };
  } catch (error) {
    console.error("❌ getBookingById Error:", error.message);
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.sendAllEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Get all students for this booking
    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });

    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 3️⃣ Venue & Class info
    const venue = await Venue.findByPk(booking.venueId);
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

    const venueName = venue?.venueName || venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const classTime =
      classSchedule?.classTime || classSchedule?.startTime || "TBA";
    const trialDate = booking.trialDate;
    const additionalNote = booking.additionalNote || "";

    // 4️⃣ Email template
    const emailConfigResult = await getEmailConfig("admin", "send email trialist");
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Build students block (table or list)
    let studentsHtml = "<ul>";
    for (const s of studentMetas) {
      studentsHtml += `<li>${s.studentFirstName} ${s.studentLastName} (Age: ${s.age}, Gender: ${s.gender})</li>`;
    }
    studentsHtml += "</ul>";

    // 6️⃣ Get unique parents across all students
    const allParents = await BookingParentMeta.findAll({
      where: { studentId: studentMetas.map((s) => s.id) },
    });

    const parentsMap = {};
    for (const parent of allParents) {
      if (parent?.parentEmail) {
        parentsMap[parent.parentEmail] = parent;
      }
    }

    // 7️⃣ Send one email per parent with all students listed
    for (const parentEmail in parentsMap) {
      const parent = parentsMap[parentEmail];

      let noteHtml = "";
      if (additionalNote && additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      let finalHtml = htmlTemplate
        .replace(/{{parentName}}/g, parent.parentFirstName)
        .replace(/{{studentsList}}/g, studentsHtml) // 🔑 add this placeholder in template
        .replace(/{{status}}/g, booking.status)
        .replace(/{{venueName}}/g, venueName)
        .replace(/{{className}}/g, className)
        .replace(/{{classTime}}/g, classTime)
        .replace(/{{trialDate}}/g, trialDate)
        .replace(/{{additionalNoteSection}}/g, noteHtml)
        .replace(/{{appName}}/g, "Synco")
        .replace(
          /{{logoUrl}}/g,
          "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
        )
        .replace(
          /{{kidsPlaying}}/g,
          "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
        )
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

// exports.getAllBookings = async (adminId, filters = {}) => {
//   try {
//     const trialWhere = {};
//     const venueWhere = {};

//     if (filters.venueId) trialWhere.venueId = filters.venueId;
//     if (filters.trialDate) trialWhere.trialDate = filters.trialDate;
//     if (filters.status) trialWhere.status = filters.status;
//     if (filters.dateBooked) {
//       const start = new Date(filters.dateBooked + " 00:00:00");
//       const end = new Date(filters.dateBooked + " 23:59:59");
//       trialWhere.createdAt = { [Op.between]: [start, end] };
//     }
//     if (filters.venueName) {
//       venueWhere.name = { [Op.like]: `%${filters.venueName}%` };
//     }
//     if (filters.sourceAgentName) {
//       trialWhere.source = { [Op.like]: `%Agent(${filters.sourceAgentName})%` };
//     }
//     // 🔹 Existing special agent source filter
//     if (filters.sourceAgentName) {
//       trialWhere.source = { [Op.like]: `%Agent(${filters.sourceAgentName})%` };
//     }

//     // 🔹 NEW generic source filter
//     if (filters.source) {
//       trialWhere.source = { [Op.like]: `%${filters.source}%` };
//     }
//     const bookings = await Booking.findAll({
//       order: [["id", "DESC"]],
//       where: trialWhere,
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents", required: false },
//             {
//               model: BookingEmergencyMeta,
//               as: "emergencyContacts",
//               required: false,
//             },
//           ],
//           required: false,
//         },
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           required: false,
//           include: [
//             {
//               model: Venue,
//               as: "venue",
//               where: venueWhere,
//               required: false,
//             },
//           ],
//         },
//       ],
//     });

//     const parsedBookings = await Promise.all(
//       bookings.map(async (booking) => {
//         const students =
//           booking.students?.map((s) => ({
//             studentFirstName: s.studentFirstName,
//             studentLastName: s.studentLastName,
//             dateOfBirth: s.dateOfBirth,
//             age: s.age,
//             gender: s.gender,
//             medicalInformation: s.medicalInformation,
//           })) || [];

//         const parents =
//           booking.students?.[0]?.parents?.map((p) => ({
//             parentFirstName: p.parentFirstName,
//             parentLastName: p.parentLastName,
//             parentEmail: p.parentEmail,
//             parentPhoneNumber: p.parentPhoneNumber,
//             relationToChild: p.relationToChild,
//             howDidYouHear: p.howDidYouHear,
//           })) || [];

//         const emergency =
//           booking.students?.[0]?.emergencyContacts?.map((e) => ({
//             emergencyFirstName: e.emergencyFirstName,
//             emergencyLastName: e.emergencyLastName,
//             emergencyPhoneNumber: e.emergencyPhoneNumber,
//             emergencyRelation: e.emergencyRelation,
//           })) || [];

//         // 🟢 Fetch payment plans just like getBookingById
//         let paymentPlans = [];
//         const venue = booking?.classSchedule?.venue;
//         if (venue) {
//           let paymentPlanIds = [];

//           if (typeof venue.paymentPlanId === "string") {
//             try {
//               paymentPlanIds = JSON.parse(venue.paymentPlanId);
//             } catch {
//               console.warn("⚠️ Failed to parse venue.paymentPlanId");
//             }
//           } else if (Array.isArray(venue.paymentPlanId)) {
//             paymentPlanIds = venue.paymentPlanId;
//           }

//           paymentPlanIds = paymentPlanIds
//             .map((id) => parseInt(id, 10))
//             .filter(Boolean);

//           if (paymentPlanIds.length) {
//             paymentPlans = await PaymentPlan.findAll({
//               where: { id: paymentPlanIds },
//             });
//           }
//         }

//         return {
//           ...booking.dataValues, // Keep all booking fields
//           students,
//           parents,
//           emergency,
//           classSchedule: booking.classSchedule || null,
//           paymentPlans,
//         };
//       })
//     );

//     let finalBookings = parsedBookings;
//     if (filters.studentName) {
//       const keyword = filters.studentName.toLowerCase();
//       finalBookings = parsedBookings.filter((booking) =>
//         booking.students.some(
//           (s) =>
//             s.studentFirstName?.toLowerCase().includes(keyword) ||
//             s.studentLastName?.toLowerCase().includes(keyword)
//         )
//       );
//     }

//     return {
//       status: true,
//       data: finalBookings,
//       totalFreeTrials: finalBookings.length,
//     };
//   } catch (error) {
//     console.error("❌ getAllBookings Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };
