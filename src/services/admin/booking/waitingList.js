const {
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
const { sequelize } = require("../../../models");

const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");

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
const DEBUG = process.env.DEBUG === "true";

exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();

  try {
    const adminId = options?.adminId;
    const source = options?.source;
    const leadId = options?.leadId || null;

    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted leadId:", leadId);
    }

    if (source !== "open" && !adminId) {
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
      if (DEBUG)
        console.log("🔍 [DEBUG] Source is 'open'. Processing first parent...");

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

      if (DEBUG)
        console.log("🔍 [DEBUG] Generated hashed password for parent account");

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
        console.log(
          "🔍 [DEBUG] Admin record:",
          admin.toJSON ? admin.toJSON() : admin
        );
      }

      if (!created) {
        if (DEBUG)
          console.log(
            "🔍 [DEBUG] Updating existing admin record with parent details"
          );

        await admin.update(
          {
            firstName: firstParent.parentFirstName,
            lastName: firstParent.parentLastName,
            phoneNumber: firstParent.parentPhoneNumber || "",
          },
          { transaction: t }
        );
      }

      if (source === "open") {
        bookedByAdminId = admin.id;
        if (DEBUG)
          console.log("🔍 [DEBUG] bookedByAdminId set to:", bookedByAdminId);
      }
    }

    // Step 1: Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        bookingId: generateBookingId(12),
        leadId,
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
        bookedBy: source === "open" ? bookedByAdminId : adminId,
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
    /*
    if (filters.bookedBy) {
      adminWhere[Op.or] = [
        { firstName: { [Op.like]: `%${filters.bookedBy}%` } },
        { lastName: { [Op.like]: `%${filters.bookedBy}%` } },
      ];
    }
    */


    if (filters.bookedBy) {
      // Ensure bookedBy is always an array
      const bookedByArray = Array.isArray(filters.bookedBy)
        ? filters.bookedBy
        : [filters.bookedBy];

      trialWhere.bookedBy = { [Op.in]: bookedByArray };
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
      where: {
        ...trialWhere, 
        status: "waiting_list", 
      },
      // where: trialWhere,
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

exports.getBookingById = async (id, bookedBy, adminId) => {
  if (!bookedBy || isNaN(Number(bookedBy))) {
    return {
      status: false,
      message: "No valid super admin found for this request.",
      data: [],
    };
  }

  try {
    const booking = await Booking.findOne({
      where: {
        bookedBy: Number(bookedBy),
        id,
        bookingType: "waiting list",
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
      ],
    });

    if (!booking) {
      return {
        status: false,
        message: "Waiting list booking not found or not authorized.",
      };
    }

    // Payment plan logic
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

    // Extract students, parents, emergency
    const students =
      booking.students?.map((s) => ({
        id: s.id,
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    const parents =
      booking.students?.[0]?.parents?.map((p) => ({
        id: p.id,
        parentFirstName: p.parentFirstName,
        parentLastName: p.parentLastName,
        parentEmail: p.parentEmail,
        parentPhoneNumber: p.parentPhoneNumber,
        relationToChild: p.relationToChild,
        howDidYouHear: p.howDidYouHear,
      })) || [];

    const emergency =
      booking.students?.[0]?.emergencyContacts?.map((e) => ({
        id: e.id,
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

exports.updateBookingStudents = async (
  bookingId,
  studentsPayload,
  transaction
) => {
  const t = transaction || (await sequelize.transaction());
  let isNewTransaction = !transaction;

  try {
    // 🔹 Fetch booking with associations
    const booking = await Booking.findOne({
      where: { id: bookingId },
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
      ],
      transaction: t,
    });

    if (!booking) {
      if (isNewTransaction) await t.rollback();
      return { status: false, message: "Booking not found" };
    }

    // 🔹 Update or create students, parents, emergency contacts
    for (const student of studentsPayload) {
      let studentRecord;

      if (student.id) {
        // Update existing student
        studentRecord = booking.students.find((s) => s.id === student.id);
        if (!studentRecord) continue;

        [
          "studentFirstName",
          "studentLastName",
          "dateOfBirth",
          "age",
          "gender",
          "medicalInformation",
        ].forEach((field) => {
          if (student[field] !== undefined)
            studentRecord[field] = student[field];
        });

        await studentRecord.save({ transaction: t });
      } else {
        // Create new student
        studentRecord = await BookingStudentMeta.create(
          { bookingId, ...student },
          { transaction: t }
        );
      }

      // Parents
      if (Array.isArray(student.parents)) {
        for (const parent of student.parents) {
          if (parent.id) {
            const parentRecord = studentRecord.parents?.find(
              (p) => p.id === parent.id
            );
            if (parentRecord) {
              [
                "parentFirstName",
                "parentLastName",
                "parentEmail",
                "parentPhoneNumber",
                "relationToChild",
                "howDidYouHear",
              ].forEach((field) => {
                if (parent[field] !== undefined)
                  parentRecord[field] = parent[field];
              });
              await parentRecord.save({ transaction: t });
            }
          } else {
            await BookingParentMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...parent },
              { transaction: t }
            );
          }
        }
      }

      // Emergency Contacts
      if (Array.isArray(student.emergencyContacts)) {
        for (const emergency of student.emergencyContacts) {
          if (emergency.id) {
            const emergencyRecord = studentRecord.emergencyContacts?.find(
              (e) => e.id === emergency.id
            );
            if (emergencyRecord) {
              [
                "emergencyFirstName",
                "emergencyLastName",
                "emergencyPhoneNumber",
                "emergencyRelation",
              ].forEach((field) => {
                if (emergency[field] !== undefined)
                  emergencyRecord[field] = emergency[field];
              });
              await emergencyRecord.save({ transaction: t });
            }
          } else {
            await BookingEmergencyMeta.create(
              { bookingStudentMetaId: studentRecord.id, ...emergency },
              { transaction: t }
            );
          }
        }
      }
    }

    if (isNewTransaction) await t.commit();

    // 🔹 Prepare structured response
    const students =
      booking.students?.map((s) => ({
        studentId: s.id,
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    const parents =
      booking.students?.flatMap(
        (s) =>
          s.parents?.map((p) => ({
            parentId: p.id,
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || []
      ) || [];

    const emergencyContacts =
      booking.students?.flatMap(
        (s) =>
          s.emergencyContacts?.map((e) => ({
            emergencyId: e.id,
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || []
      ) || [];

    return {
      status: true,
      message: "Booking updated successfully",
      data: {
        bookingId: booking.id,
        status: booking.status,
        students,
        parents,
        emergencyContacts,
      },
    };
  } catch (error) {
    if (isNewTransaction) await t.rollback();
    console.error("❌ Service updateBookingStudents Error:", error.message);
    return { status: false, message: error.message };
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
    const trialDate = booking.trialDate || booking.startDate;
    const additionalNote = booking.additionalNote || "";
    const status = booking.status || "active ";

    // 4️⃣ Email template
    const emailConfigResult = await getEmailConfig(
      "admin",
      "waiting-listing-sendEmail"
    );
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Get unique parents for all students
    const allParents = await BookingParentMeta.findAll({
      where: { studentId: studentMetas.map((s) => s.id) },
    });
    const parentsMap = {};
    for (const parent of allParents) {
      if (parent?.parentEmail) {
        parentsMap[parent.parentEmail] = parent;
      }
    }

    // 6️⃣ Build students list and table HTML
    const studentsList = studentMetas
      .map((s) => `${s.studentFirstName} ${s.studentLastName}`)
      .join(", ");
    const studentsTableRows = studentMetas
      .map(
        (s) => `
      <tr>
        <td style="padding:8px;">${s.studentFirstName} ${s.studentLastName}</td>
        <td style="padding:8px;">${s.className || className}</td>
        <td style="padding:8px;">${s.classTime || classTime}</td>
        <td style="padding:8px;">${trialDate}</td>
      </tr>
    `
      )
      .join("");

    // 7️⃣ Send email to each parent
    for (const parentEmail in parentsMap) {
      const parent = parentsMap[parentEmail];

      let noteHtml = "";
      if (additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      let finalHtml = htmlTemplate
        .replace(/{{parentName}}/g, parent.parentFirstName)
        .replace(/{{status}}/g, status)
        .replace(/{{studentsList}}/g, studentsList)
        .replace(/{{studentsTableRows}}/g, studentsTableRows)
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

exports.removeWaitingList = async ({ bookingId, reason, notes }) => {
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
    booking.bookingType = "removed";
    await booking.save();

    // 3. Insert record in CancelBooking
    await CancelBooking.create({
      bookingId: booking.id,
      bookingType: "removed",
      removedReason: reason,
      removedNotes: notes || null,
      // removedBy, // optional: who removed
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
    const adminId = options?.adminId || null;

    // Step 1: Update existing booking or create new one
    let booking;
    if (data.id) {
      booking = await Booking.findByPk(data.id, {
        include: [{ model: BookingStudentMeta, as: "students" }],
        transaction: t,
      });
      if (!booking) throw new Error("Booking not found with provided id");

      await booking.update(
        {
          totalStudents: data.totalStudents ?? booking.totalStudents,
          classScheduleId: data.classScheduleId ?? booking.classScheduleId,
          startDate: data.startDate ?? booking.startDate,
          trialDate: null,
          bookingType: data.paymentPlanId ? "paid" : booking.bookingType,
          paymentPlanId: data.paymentPlanId ?? booking.paymentPlanId,
          status: data.paymentPlanId ? "active" : data.status ?? booking.status,
          bookedBy: adminId || booking.bookedBy,
        },
        { transaction: t }
      );
    } else {
      booking = await Booking.create(
        {
          venueId: data.venueId,
          bookingId: generateBookingId(12),
          totalStudents: data.totalStudents,
          classScheduleId: data.classScheduleId,
          startDate: data.startDate,
          trialDate: null,
          bookingType: data.paymentPlanId ? "paid" : "waiting list",
          paymentPlanId: data.paymentPlanId || null,
          status: data.status || "active",
          bookedBy: adminId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
      booking.students = [];
    }

    // Step 2 & 3: Update or create students, link parents & emergency
    const studentRecords = [];
    let currentCount = booking.students.length || 0;

    for (const student of data.students || []) {
      let studentRecord;

      if (student.id) {
        studentRecord = booking.students.find((s) => s.id === student.id);
        if (studentRecord) {
          await studentRecord.update(
            {
              studentFirstName: student.studentFirstName,
              studentLastName: student.studentLastName,
              dateOfBirth: student.dateOfBirth,
              age: student.age,
              gender: student.gender,
              medicalInformation: student.medicalInformation || null,
            },
            { transaction: t }
          );
        }
      } else {
        // Create new student (limit 3)
        if (currentCount >= 3)
          throw new Error(
            "You cannot add more than 3 students in one booking."
          );

        studentRecord = await BookingStudentMeta.create(
          {
            bookingTrialId: booking.id,
            studentFirstName: student.studentFirstName,
            studentLastName: student.studentLastName,
            dateOfBirth: student.dateOfBirth,
            age: student.age,
            gender: student.gender,
            medicalInformation: student.medicalInformation || null,
          },
          { transaction: t }
        );
        booking.students.push(studentRecord);
        currentCount++;
      }

      studentRecords.push(studentRecord);

      // Link parents to this student
      if (Array.isArray(data.parents)) {
        for (const parent of data.parents) {
          if (parent.id) {
            const existingParent = await BookingParentMeta.findByPk(parent.id, {
              transaction: t,
            });
            if (existingParent) {
              await existingParent.update(
                { ...parent, studentId: studentRecord.id },
                { transaction: t }
              );
            } else {
              await BookingParentMeta.create(
                { ...parent, studentId: studentRecord.id },
                { transaction: t }
              );
            }
          } else {
            await BookingParentMeta.create(
              { ...parent, studentId: studentRecord.id },
              { transaction: t }
            );
          }
        }
      }

      // Link emergency contact to this student
      if (data.emergency && Object.keys(data.emergency).length > 0) {
        const emergency = data.emergency;
        if (emergency.id) {
          const existingEmergency = await BookingEmergencyMeta.findByPk(
            emergency.id,
            { transaction: t }
          );
          if (existingEmergency) {
            await existingEmergency.update(
              { ...emergency, studentId: studentRecord.id },
              { transaction: t }
            );
          } else {
            await BookingEmergencyMeta.create(
              { ...emergency, studentId: studentRecord.id },
              { transaction: t }
            );
          }
        } else {
          await BookingEmergencyMeta.create(
            { ...emergency, studentId: studentRecord.id },
            { transaction: t }
          );
        }
      }
    }

    // Step 5: Payment Handling (GoCardless / Pay360)
    if (booking.paymentPlanId && data.payment?.paymentType) {
      const paymentType = data.payment.paymentType;
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
          {
            transaction: t,
          }
        );

        const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
        let gatewayResponse = null;
        let goCardlessCustomer, goCardlessBankAccount, goCardlessBillingRequest;

        if (paymentType === "bank") {
          // GoCardless customer + billing request
          const customerPayload = {
            email: data.payment.email || data.parents?.[0]?.parentEmail || "",
            given_name: data.payment.firstName || "",
            family_name: data.payment.lastName || "",
            address_line1: data.payment.addressLine1 || "",
            city: data.payment.city || "",
            postal_code: data.payment.postalCode || "",
            country_code: data.payment.countryCode || "GB",
            currency: data.payment.currency || "GBP",
            account_holder_name: data.payment.account_holder_name || "",
            account_number: data.payment.account_number || "",
            branch_code: data.payment.branch_code || "",
          };

          const createCustomerRes = await createCustomer(customerPayload);
          if (!createCustomerRes.status)
            throw new Error(createCustomerRes.message);

          const billingRequestPayload = {
            customerId: createCustomerRes.customer.id,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            amount: price,
            scheme: "faster_payments",
            currency: "GBP",
            reference: `TRX-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000
            )}`,
            mandateReference: `MD-${Date.now()}-${Math.floor(
              1000 + Math.random() * 9000
            )}`,
            fallbackEnabled: true,
          };

          const createBillingRequestRes = await createBillingRequest(
            billingRequestPayload
          );
          if (!createBillingRequestRes.status) {
            await removeCustomer(createCustomerRes.customer.id);
            throw new Error(createBillingRequestRes.message);
          }

          goCardlessCustomer = createCustomerRes.customer;
          goCardlessBankAccount = createCustomerRes.bankAccount;
          goCardlessBillingRequest = createBillingRequestRes.billingRequest;
        } else if (paymentType === "card") {
          // Pay360 card payment
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

        // Save BookingPayment
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
            amount: price,
            billingAddress: data.payment.billingAddress || "",
            account_holder_name: data.payment.account_holder_name || "",
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
            goCardlessCustomer,
            goCardlessBankAccount,
            goCardlessBillingRequest,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );

        if (paymentStatusFromGateway === "failed") {
          throw new Error("Payment failed. Booking not updated.");
        }
      } catch (err) {
        await t.rollback();
        const errorMessage =
          err.response?.data?.reasonMessage || err.message || "Payment failed";
        return { status: false, message: errorMessage };
      }
    }

    // Step 6: Update Class Capacity
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
