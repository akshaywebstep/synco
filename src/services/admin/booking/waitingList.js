const {
  sequelize,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  PaymentPlan,
  Venue,
  Admin,
  CancelBooking,
  BookingPayment,
} = require("../../../models");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");

const DEBUG = process.env.DEBUG === "true";

const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const axios = require("axios");

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

    if (source !== 'open' && !adminId) {
      throw new Error("Admin ID is required for bookedBy");
    }

    // 🔍 Fetch the actual class schedule record
    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
      transaction: t,
    });

    if (!classSchedule) {
      throw new Error("Invalid class schedule selected.");
    }

    let bookingStatus;
    let newCapacity = classSchedule.capacity;

    if (classSchedule.capacity === 0) {
      // ✅ Capacity is 0 → allow waiting list
      bookingStatus = "waiting list";
    } else {
      // ❌ Capacity is available → reject waiting list
      throw new Error(
        `Class has available seats (${classSchedule.capacity}). Cannot add to waiting list.`
      );
    }

    if (data.parents?.length > 0) {
      if (DEBUG) console.log("🔍 [DEBUG] Source is 'open'. Processing first parent...");

      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (DEBUG) console.log("🔍 [DEBUG] Extracted parent email:", email);

      if (!email) throw new Error("Parent email is required for open booking");

      // 🔍 Check duplicate email in Admin table
      const existingAdmin = await Admin.findOne({
        where: { email },
        transaction: t,
      });

      if (existingAdmin) {
        throw new Error(
          `Parent with email ${email} already exists as an admin.`
        );
      }

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
        bookingId: generateBookingId(12),
        totalStudents: data.totalStudents,
        startDate: data.startDate,
        classScheduleId: data.classScheduleId,
        bookingType:
          bookingStatus === "waiting list"
            ? "waiting list"
            : data.paymentPlanId
              ? "paid"
              : "free",
        className: data.className,
        classTime: data.classTime,
        // keyInformation: data.keyInformation,
        status: bookingStatus,
        bookedBy: source === 'open' ? bookedByAdminId : adminId,
        intrest: data.intrest,
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

      for (const parent of data.parents) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email || !emailRegex.test(email)) {
          throw new Error(`Invalid or missing parent email: ${email}`);
        }

        // 🔍 Check duplicate email in BookingParentMeta
        const existingParent = await BookingParentMeta.findOne({
          where: { parentEmail: email },
          transaction: t,
        });

        if (existingParent) {
          throw new Error(
            `Parent with email ${email} already exists in booking records.`
          );
        }

        // ✅ Create BookingParentMeta
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

    // Step 5: Update Class Capacity only if confirmed booking
    if (bookingStatus !== "waiting list") {
      await ClassSchedule.update({ capacity: newCapacity }, { transaction: t });
    }

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

exports.getWaitingList = async (filters = {}) => {
  try {
    const trialWhere = {
      bookingType: "waiting list",
    };

    if (filters.status) trialWhere.status = filters.status;
    if (filters.interest) trialWhere.interest = filters.interest;

    const adminWhere = {};
    if (filters.bookedBy) {
      adminWhere[Op.or] = [
        { firstName: { [Op.like]: `%${filters.bookedBy}%` } },
        { lastName: { [Op.like]: `%${filters.bookedBy}%` } },
      ];
    }

    // ---- Date filters ----
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      trialWhere.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.lte]: end };
    }

    if (filters.startDate) {
      const start = new Date(filters.startDate + " 00:00:00");
      const end = new Date(filters.startDate + " 23:59:59");
      trialWhere.startDate = { [Op.between]: [start, end] };
    }

    const studentWhere = {};
    if (filters.studentName) {
      studentWhere[Op.or] = [
        { studentFirstName: { [Op.like]: `%${filters.studentName}%` } },
        { studentLastName: { [Op.like]: `%${filters.studentName}%` } },
      ];
    }

    const bookings = await Booking.findAll({
      order: [["id", "DESC"]],
      where: trialWhere,
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: !!filters.studentName,
          where: filters.studentName ? studentWhere : undefined,
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
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
          required: !!filters.venueName,
          include: [
            {
              model: Venue,
              as: "venue",
              required: !!filters.venueName,
              where: filters.venueName
                ? { name: { [Op.like]: `%${filters.venueName}%` } }
                : undefined,
            },
          ],
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
          required: !!filters.bookedBy,
          where: filters.bookedBy ? adminWhere : undefined,
        },
      ],
    });

    // ---- Transform Data ----
    const parsedBookings = bookings.map((booking) => {
      const students =
        booking.students?.map((s) => ({
          studentFirstName: s.studentFirstName,
          studentLastName: s.studentLastName,
          dateOfBirth: s.dateOfBirth,
          age: s.age,
          gender: s.gender,
          medicalInformation: s.medicalInformation,
          interest: s.interest,
        })) || [];

      const parents =
        booking.students?.flatMap(
          (s) =>
            s.parents?.map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            })) || []
        ) || [];

      const emergency =
        booking.students?.flatMap(
          (s) =>
            s.emergencyContacts?.map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            })) || []
        )[0] || null;
      // ---- Calculate waitingDays based on startDate ----
      let waitingDays = null;
      if (booking.startDate) {
        const start = new Date(booking.startDate);
        const now = new Date();
        waitingDays = Math.ceil(
          (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      return {
        ...booking.dataValues,
        students,
        parents,
        emergency,
        classSchedule: booking.classSchedule || null,
        venue: booking.classSchedule?.venue || null,
        bookedByAdmin: booking.bookedByAdmin || null,
        waitingDays,
      };
    });

    // ---- Extract unique Venues + Admins ----
    const venues = [];
    const bookedByAdmins = [];

    parsedBookings.forEach((b) => {
      if (b.venue && !venues.find((v) => v.id === b.venue.id)) {
        venues.push(b.venue);
      }
      if (
        b.bookedByAdmin &&
        !bookedByAdmins.find((a) => a.id === b.bookedByAdmin.id)
      ) {
        bookedByAdmins.push(b.bookedByAdmin);
      }
    });

    // ---- Stats Calculation ----
    const totalOnWaitingList = parsedBookings.length;

    // Avg. interest (based on students’ interest field)
    const allInterests = parsedBookings.flatMap((b) =>
      b.students.map((s) => parseInt(s.interest) || 0)
    );
    const avgInterest =
      allInterests.length > 0
        ? (
          allInterests.reduce((a, b) => a + b, 0) / allInterests.length
        ).toFixed(2)
        : 0;

    // Avg. days waiting (currentDate - createdAt)
    const avgDaysWaiting =
      parsedBookings.length > 0
        ? (
          parsedBookings.reduce((sum, b) => {
            const created = new Date(b.createdAt);
            const now = new Date();
            const diffDays = Math.floor(
              (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
            );
            return sum + diffDays;
          }, 0) / parsedBookings.length
        ).toFixed(0)
        : 0;

    // Top Referrer (admin with most bookings)
    const adminCount = {};
    parsedBookings.forEach((b) => {
      if (b.bookedByAdmin) {
        const name = `${b.bookedByAdmin.firstName} ${b.bookedByAdmin.lastName}`;
        adminCount[name] = (adminCount[name] || 0) + 1;
      }
    });
    const topReferrer =
      Object.entries(adminCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Most Requested Venue
    const venueCount = {};
    parsedBookings.forEach((b) => {
      if (b.venue) {
        venueCount[b.venue.name] = (venueCount[b.venue.name] || 0) + 1;
      }
    });
    const mostRequestedVenue =
      Object.entries(venueCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      status: true,
      message: "Waiting list bookings fetched successfully.",
      data: {
        waitingList: parsedBookings,
        venue: venues,
        bookedByAdmins,
        stats: {
          totalOnWaitingList,
          avgInterest,
          avgDaysWaiting,
          topReferrer,
          mostRequestedVenue,
        },
      },
    };
  } catch (error) {
    console.error("❌ getWaitingList Error:", error);
    return {
      status: false,
      message: error.message || "Failed to fetch waiting list",
      data: {
        waitingList: [],
        venue: [],
        bookedByAdmins: [],
        stats: {
          totalOnWaitingList: 0,
          avgInterest: 0,
          avgDaysWaiting: 0,
          topReferrer: null,
          mostRequestedVenue: null,
        },
      },
    };
  }
};

exports.getBookingById = async (id, adminId) => {
  try {
    const booking = await Booking.findOne({
      where: {
        id,
        bookingType: "waiting list", // ✅ Only waiting list bookings
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: false,
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
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
          include: [{ model: Venue, as: "venue", required: false }],
        },
        {
          model: Admin, // ✅ Include bookedBy admin
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
      ],
    });

    if (!booking) {
      return {
        status: false,
        message: "Waiting list booking not found or not authorized.",
      };
    }

    // Handle payment plans
    let paymentPlans = [];
    let paymentPlanIds = [];

    const venue = booking.classSchedule?.venue;
    if (venue?.paymentPlanId) {
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

    // Extract students
    const students =
      booking.students?.map((s) => ({
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    // Extract parents from first student
    const parents =
      booking.students?.[0]?.parents?.map((p) => ({
        parentFirstName: p.parentFirstName,
        parentLastName: p.parentLastName,
        parentEmail: p.parentEmail,
        parentPhoneNumber: p.parentPhoneNumber,
        relationToChild: p.relationToChild,
        howDidYouHear: p.howDidYouHear,
      })) || [];

    // Extract emergency contacts from first student
    const emergency =
      booking.students?.[0]?.emergencyContacts?.map((e) => ({
        emergencyFirstName: e.emergencyFirstName,
        emergencyLastName: e.emergencyLastName,
        emergencyPhoneNumber: e.emergencyPhoneNumber,
        emergencyRelation: e.emergencyRelation,
      })) || [];

    // Final response
    const response = {
      id: booking.id,
      bookingId: booking.bookingId,
      classScheduleId: booking.classScheduleId,
      // trialDate: booking.trialDate,
      startDate: booking.startDate,
      interest: booking.interest,
      bookedBy: booking.bookedByAdmin || null,
      className: booking.className,
      classTime: booking.classTime,
      venueId: booking.venueId,
      status: booking.status,
      bookingType: booking.bookingType,
      totalStudents: booking.totalStudents,
      source: booking.source,
      createdAt: booking.createdAt,
      venue,
      students,
      parents,
      emergency,

      classSchedule: booking.classSchedule || {},
      paymentPlans,
    };

    return {
      status: true,
      message: "Fetched waiting list booking successfully.",
      data: response,
    };
  } catch (error) {
    console.error("❌ getBookingById Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.sendAllEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch main booking
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
    const emailConfigResult = await getEmailConfig("admin", "booking-status");
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Loop over students
    for (const student of studentMetas) {
      // Get all parents for this student
      const parents = await BookingParentMeta.findAll({
        where: { studentId: student.id },
      });

      if (!parents.length) continue;

      let noteHtml = "";
      if (additionalNote && additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      // 6️⃣ Send email to each parent
      for (const parent of parents) {
        if (!parent?.parentEmail) continue;

        let finalHtml = htmlTemplate
          .replace(/{{parentName}}/g, parent.parentFirstName)
          .replace(/{{studentFirstName}}/g, student.studentFirstName)
          .replace(/{{studentLastName}}/g, student.studentLastName)
          .replace(
            /{{studentName}}/g,
            `${student.studentFirstName} ${student.studentLastName}`
          )
          .replace(/{{status}}/g, booking.status) // make sure booking.status exists
          .replace(/{{venueName}}/g, venueName)
          .replace(/{{className}}/g, className)
          .replace(/{{classTime}}/g, classTime)
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
      message: `Emails sent to ${sentTo.length} parents`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

exports.removeWaitingList = async ({ bookingId, removedBy, reason, notes }) => {
  try {
    // 1. Find the booking in waiting list
    const booking = await Booking.findOne({
      where: {
        id: bookingId,
        bookingType: "waiting list",
      },
    });

    if (!booking) {
      return {
        status: false,
        message: "Waiting list booking not found.",
      };
    }

    // 2. Update booking table -> status + bookingType
    booking.status = "removed";
    booking.bookingType = "removed"; // ✅ also update bookingType
    await booking.save();

    // 3. Insert record in CancelBooking
    await CancelBooking.create({
      bookingId: booking.id,
      bookingType: "removed", // ✅ original type stored
      removedReason: reason,
      removedNotes: notes || null,
    });

    return {
      status: true,
      message: "Booking removed from waiting list successfully.",
      data: {
        bookingId: booking.id,
        status: "removed",
        bookingType: "removed",
        removedReason: reason,
        removedNotes: notes || null,
      },
    };
  } catch (error) {
    console.error("❌ removeWaitingList Error:", error.message);
    return {
      status: false,
      message: error.message || "Failed to remove from waiting list",
    };
  }
};

function generateBookingId(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

exports.convertToMembership = async (data, options) => {
  const t = await sequelize.transaction();
  try {
    const bookedBy = options?.adminId || null;

    // 🔹 Step 1: Update existing booking if id is passed, else create new
    let booking;

    if (data.id) {
      // ✅ Fetch by primary key
      booking = await Booking.findByPk(data.id, { transaction: t });
      if (!booking) throw new Error("Booking not found with provided id");

      // ✅ Update fields to convert waiting list → membership
      await booking.update(
        {
          totalStudents: data.totalStudents ?? booking.totalStudents,
          classScheduleId: data.classScheduleId ?? booking.classScheduleId,
          startDate: data.startDate ?? booking.startDate,
          // ✅ Clear startDate when converting to membership
          trialDate: null,
          // keyInformation: data.keyInformation ?? booking.keyInformation,
          // ✅ Convert to paid membership if paymentPlanId is passed
          bookingType: data.paymentPlanId ? "paid" : booking.bookingType,
          paymentPlanId: data.paymentPlanId ?? booking.paymentPlanId,

          // ✅ Explicitly set status to active/paid
          status: data.paymentPlanId ? "active" : data.status ?? booking.status,
          bookedBy: options?.adminId || booking.bookedBy,
        },
        { transaction: t }
      );
    } else {
      // ✅ Create new booking (old behavior)
      booking = await Booking.create(
        {
          venueId: data.venueId,
          bookingId: generateBookingId(12),
          totalStudents: data.totalStudents,
          classScheduleId: data.classScheduleId,
          trialDate: null, // always null for waiting list
          startDate: data.startDate,
          // keyInformation: data.keyInformation || null,
          bookingType: data.paymentPlanId ? "paid" : "waiting list",
          paymentPlanId: data.paymentPlanId || null,
          status: data.status || "active",
          bookedBy: options?.adminId || null,
        },
        { transaction: t }
      );
    }

    // 🔹 Step 2: Update Students (no creation)
    const studentRecords = [];
    for (const student of data.students || []) {
      // You can also match by student.id if you have it in payload
      let existingStudent = await BookingStudentMeta.findOne({
        where: {
          bookingTrialId: booking.id,
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
        },
        transaction: t,
      });

      if (existingStudent) {
        await existingStudent.update(
          {
            dateOfBirth: student.dateOfBirth,
            age: student.age,
            gender: student.gender,
            medicalInformation: student.medicalInformation,
          },
          { transaction: t }
        );
        studentRecords.push(existingStudent);
      }
    }

    // 🔹 Step 3: Update Parents (no creation)
    if (data.parents?.length && studentRecords.length) {
      const firstStudent = studentRecords[0];

      for (const parent of data.parents) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        if (!email) throw new Error("Parent email is required.");

        // Find existing parent
        let existingParent = await BookingParentMeta.findOne({
          where: { studentId: firstStudent.id, parentEmail: email },
          transaction: t,
        });

        if (existingParent) {
          await existingParent.update(
            {
              parentFirstName: parent.parentFirstName,
              parentLastName: parent.parentLastName,
              parentPhoneNumber: parent.parentPhoneNumber,
              relationToChild: parent.relationToChild,
              howDidYouHear: parent.howDidYouHear,
            },
            { transaction: t }
          );
        }

        // Update Admin if exists (skip creation)
        let existingAdmin = await Admin.findOne({
          where: { email },
          transaction: t,
        });

        if (existingAdmin) {
          await existingAdmin.update(
            {
              firstName: parent.parentFirstName || existingAdmin.firstName,
              lastName: parent.parentLastName || existingAdmin.lastName,
              phoneNumber:
                parent.parentPhoneNumber || existingAdmin.phoneNumber,
              updatedAt: new Date(),
            },
            { transaction: t }
          );
        }
      }
    }

    // 🔹 Step 4: Update Emergency Contact (no creation)
    if (
      data.emergency?.emergencyFirstName &&
      data.emergency?.emergencyPhoneNumber &&
      studentRecords.length
    ) {
      const firstStudent = studentRecords[0];
      let existingEmergency = await BookingEmergencyMeta.findOne({
        where: { studentId: firstStudent.id },
        transaction: t,
      });

      if (existingEmergency) {
        await existingEmergency.update(
          {
            emergencyFirstName: data.emergency.emergencyFirstName,
            emergencyLastName: data.emergency.emergencyLastName,
            emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
            emergencyRelation: data.emergency.emergencyRelation,
          },
          { transaction: t }
        );
      }
    }

    // 🔹 Step 5: Payment Handling (only if paymentPlanId exists)
    if (booking.paymentPlanId && data.payment?.paymentType) {
      const paymentType = data.payment.paymentType;
      console.log("Step 5: Start payment process, paymentType:", paymentType);

      let paymentStatusFromGateway = "pending";
      const firstStudentId = studentRecords[0]?.id;

      try {
        const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
          transaction: t,
        });
        if (!paymentPlan) throw new Error("Invalid payment plan selected.");
        const price = paymentPlan.price || 0;

        const venue = await Venue.findByPk(data.venueId, { transaction: t });
        const classSchedule = await ClassSchedule.findByPk(
          data.classScheduleId,
          { transaction: t }
        );

        const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
        let gatewayResponse = null;
        const amountInPence = Math.round(price * 100);

        if (paymentType === "rrn") {
          if (!data.payment.referenceId)
            throw new Error("Reference ID is required for RRN payments.");

          const gcPayload = {
            cardHolderName: null,
            cv2: null,
            expiryDate: null,
            pan: null,
            billing_requests: {
              payment_request: {
                description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
                  }`,
                amount: amountInPence,
                scheme: "faster_payments",
                currency: "GBP",
                metadata: { referenceId: data.payment.referenceId },
              },
              mandate_request: {
                currency: "GBP",
                scheme: "bacs",
                verify: "recommended",
                metadata: { referenceId: data.payment.referenceId },
              },
              links: {},
              metadata: { test: `BR${Math.floor(Math.random() * 1000000)}` },
            },
          };

          const response = await axios.post(
            "https://api-sandbox.gocardless.com/billing_requests",
            gcPayload,
            {
              headers: {
                Authorization: `Bearer ${process.env.GOCARDLESS_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "GoCardless-Version": "2015-07-06",
              },
            }
          );

          gatewayResponse = response.data;
          paymentStatusFromGateway =
            gatewayResponse?.billing_requests?.status || "pending";
        } else if (paymentType === "card") {
          if (
            !process.env.PAY360_INST_ID ||
            !process.env.PAY360_API_USERNAME ||
            !process.env.PAY360_API_PASSWORD
          )
            throw new Error("Pay360 credentials not set.");

          const paymentPayload = {
            transaction: {
              currency: "GBP",
              amount: price,
              merchantRef,
              description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
                }`,
              commerceType: "ECOM",
            },
            paymentMethod: {
              card: {
                pan: data.payment.pan,
                expiryDate: data.payment.expiryDate,
                cardHolderName: data.payment.cardHolderName,
                cv2: data.payment.cv2,
              },
            },
          };

          const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${process.env.PAY360_INST_ID}/payment`;
          const authHeader = Buffer.from(
            `${process.env.PAY360_API_USERNAME}:${process.env.PAY360_API_PASSWORD}`
          ).toString("base64");

          const response = await axios.post(url, paymentPayload, {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${authHeader}`,
            },
          });

          gatewayResponse = response.data;
          const txnStatus = gatewayResponse?.transaction?.status?.toLowerCase();
          if (txnStatus === "success") paymentStatusFromGateway = "paid";
          else if (txnStatus === "pending")
            paymentStatusFromGateway = "pending";
          else if (txnStatus === "declined")
            paymentStatusFromGateway = "failed";
          else paymentStatusFromGateway = txnStatus || "unknown";
        }

        await BookingPayment.create(
          {
            bookingId: booking.id,
            paymentPlanId: booking.paymentPlanId,
            studentId: firstStudentId,
            paymentType,
            firstName:
              data.payment.firstName ||
              data.parents?.[0]?.parentFirstName ||
              "",
            lastName:
              data.payment.lastName || data.parents?.[0]?.parentLastName || "",
            email: data.payment.email || data.parents?.[0]?.parentEmail || "",
            billingAddress: data.payment.billingAddress || "",
            cardHolderName: data.payment.cardHolderName || "",
            cv2: data.payment.cv2 || "",
            expiryDate: data.payment.expiryDate || "",
            pan: data.payment.pan || "",
            referenceId: data.payment.referenceId || "",
            paymentStatus: paymentStatusFromGateway,
            currency:
              gatewayResponse?.transaction?.currency ||
              gatewayResponse?.billing_requests?.currency ||
              "GBP",
            merchantRef:
              gatewayResponse?.transaction?.merchantRef || merchantRef,
            description:
              gatewayResponse?.transaction?.description ||
              `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            commerceType: "ECOM",
            gatewayResponse,
            transactionMeta: {
              status:
                gatewayResponse?.transaction?.status ||
                gatewayResponse?.billing_requests?.status ||
                "unknown",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );

        if (paymentStatusFromGateway === "failed") {
          throw new Error("Payment failed. Booking not created.");
        }
      } catch (err) {
        let errorMessage = "Payment failed";

        if (err.response?.data) {
          if (typeof err.response.data === "string") {
            errorMessage = err.response.data;
          } else if (err.response.data.reasonMessage) {
            errorMessage = err.response.data.reasonMessage;
          } else if (err.response.data.error?.message) {
            errorMessage = err.response.data.error.message;
          } else {
            errorMessage = Object.values(err.response.data).join(" | ");
          }
        } else if (err.message) {
          errorMessage = err.message;
        }

        await t.rollback();
        return { status: false, message: errorMessage };
      }
    }

    // 🔹 Step 6: Update Class Capacity
    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
      transaction: t,
    });
    const newCapacity = classSchedule.capacity - data.totalStudents;
    if (newCapacity < 0) throw new Error("Not enough capacity left.");
    await classSchedule.update({ capacity: newCapacity }, { transaction: t });

    await t.commit();
    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentRecords[0]?.id,
        studentFirstName: studentRecords[0]?.studentFirstName,
        studentLastName: studentRecords[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};
