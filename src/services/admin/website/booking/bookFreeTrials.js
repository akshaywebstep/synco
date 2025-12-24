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
} = require("../../../../models");
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
    
    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted leadId:", leadId);
    }

    if (source !== "open" && !adminId) {
      throw new Error("Admin ID is required for bookedBy");
    }

    let bookedByAdminId = adminId || null;

    if (data.parents?.length > 0) {
      if (DEBUG)
        console.log("🔍 [DEBUG] Source is 'open'. Processing first parent...");

      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (DEBUG) console.log("🔍 [DEBUG] Extracted parent email:", email);

      if (!email) throw new Error("Parent email is required for open booking");

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
          roleId: 9, 
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
        bookingId: generateBookingId(12), // random booking reference
        leadId,
        totalStudents: data.totalStudents,
        classScheduleId: data.classScheduleId,
        trialDate: data.trialDate,
        className: data.className,
        serviceType: "weekly class trial",
        attempt: 1,
        classTime: data.classTime,
        status: data.status || "pending",
        bookedBy: source === "open" ? bookedByAdminId : adminId,
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