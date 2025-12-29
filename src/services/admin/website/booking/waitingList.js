const {
    Booking,
    BookingStudentMeta,
    BookingParentMeta,
    BookingEmergencyMeta,
    ClassSchedule,
    Admin,
    AdminRole,
} = require("../../../../models");
const { sequelize } = require("../../../../models");
const { getEmailConfig } = require("../../../email");
const sendEmail = require("../../../../utils/email/sendEmail");
const DEBUG = process.env.DEBUG === "true";

const bcrypt = require("bcrypt");

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
                    `Parent with email ${email} already exists.`
                );
            }

            const plainPassword = "Synco123";
            const hashedPassword = await bcrypt.hash(plainPassword, 10);

            if (DEBUG)
                console.log("🔍 [DEBUG] Generated hashed password for parent account");
            // 🔹 Fetch Parent role
            const parentRole = await AdminRole.findOne({
                where: { role: "Parents" }, // ✅ correct column
                transaction: t,
            });
            if (DEBUG) console.log("🔍 [DEBUG] Extracted parent role:", parentRole);

            if (!parentRole) {
                throw new Error("Parent role not found");
            }

            const parentRoleId = parentRole.id;

            const [admin, created] = await Admin.findOrCreate({
                where: { email },
                defaults: {
                    firstName: firstParent.parentFirstName || "Parent",
                    lastName: firstParent.parentLastName || "",
                    phoneNumber: firstParent.parentPhoneNumber || "",
                    email,
                    password: hashedPassword,
                    roleId: parentRoleId,
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
        }

        // Step 1: Create Booking
        const booking = await Booking.create(
            {
                venueId: data.venueId,
                bookingId: generateBookingId(12),
                leadId,
                serviceType: "weekly class trial",
                totalStudents: data.totalStudents,
                startDate: data.startDate,
                classScheduleId: data.classScheduleId,
                bookingType: "waiting list",
                className: data.className,
                classTime: data.classTime,
                status: bookingStatus,
                bookedBy: source === "open" ? null : adminId,
                source: source === "open" ? "website" : "admin",
                interest: data.interest,
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
                        `Parent with email ${email} already exists in booking.`
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
            await BookingEmergencyMeta.create({
                studentId: firstStudent.id,
                emergencyFirstName: data.emergency.emergencyFirstName,
                emergencyLastName: data.emergency.emergencyLastName,
                emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
                emergencyRelation: data.emergency.emergencyRelation,
            });
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