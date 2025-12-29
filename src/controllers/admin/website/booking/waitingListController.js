const { validateFormData } = require("../../../../utils/validateFormData");
const WaitingListService = require("../../../../services/admin/website/booking/waitingList");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const {
    Venue,
    ClassSchedule,
    Admin,
    BookingParentMeta,
    BookingStudentMeta,
} = require("../../../../models");
const emailModel = require("../../../../services/email");
const sendEmail = require("../../../../utils/email/sendEmail");
const {
    createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "open";
const MODULE = "waiting-list";

// Create Book a Free Trial
exports.createBooking = async (req, res) => {
    if (DEBUG) console.log("📥 Received booking request");
    const formData = req.body;

    if (DEBUG) console.log("🔍 Fetching class data...");
    const classData = await ClassSchedule.findByPk(formData.classScheduleId);
    if (!classData) {
        if (DEBUG) console.warn("❌ Class not found.");
        return res.status(404).json({ status: false, message: "Class not found." });
    }

    if (DEBUG) console.log("✅ Validating form data...");
    const { isValid, error } = validateFormData(formData, {
        requiredFields: [
            "totalStudents",
            "classScheduleId",
            "interest",
            "startDate",
            "students", // array, validate inside loop
            "parents", // array, validate inside loop
            //   "emergency", // object, validate inside
        ],
    });

    // Validate students
    if (!Array.isArray(formData.students) || formData.students.length === 0) {
        return res.status(400).json({
            status: false,
            message: "At least one student must be provided.",
        });
    }

    for (const student of formData.students) {
        const { isValid, error } = validateFormData(student, {
            requiredFields: [
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "medicalInformation",
            ],
        });
        if (!isValid) {
            return res.status(400).json({ status: false, ...error });
        }
    }

    // Validate parents
    if (!Array.isArray(formData.parents) || formData.parents.length === 0) {
        return res.status(400).json({
            status: false,
            message: "At least one parent must be provided.",
        });
    }

    for (const parent of formData.parents) {
        const { isValid, error } = validateFormData(parent, {
            requiredFields: [
                "parentFirstName",
                "parentLastName",
                "parentEmail",
                "parentPhoneNumber",
            ],
        });
        if (!isValid) {
            return res.status(400).json({ status: false, ...error });
        }
    }

    // Validate emergency
    if (formData.emergency) {
        const { isValid, error } = validateFormData(formData.emergency, {
            requiredFields: [
                "emergencyFirstName",
                "emergencyLastName",
                "emergencyPhoneNumber",
                "emergencyRelation",
            ],
        });

        if (!isValid) {
            return res.status(400).json({ status: false, ...error });
        }
    }

    if (DEBUG) console.log("📍 Setting class metadata...");
    formData.venueId = classData.venueId;
    formData.className = classData.className;
    formData.classTime = `${classData.startTime} - ${classData.endTime}`;

    if (DEBUG) console.log("🏫 Fetching venue data...");
    const venue = await Venue.findByPk(formData.venueId);
    if (!venue) {
        const message = "Venue linked to this class is not configured.";
        if (DEBUG) console.warn("❌ Venue not found.");
        await logActivity(req, PANEL, MODULE, "create", { message }, false);
        return res.status(404).json({ status: false, message });
    }

    if (DEBUG) console.log("👨‍👩‍👧 Validating students and parents...");
    const emailMap = new Map();
    const duplicateEmails = [];

    for (const student of formData.students) {
        if (
            !student.studentFirstName ||
            !student.dateOfBirth ||
            !student.medicalInformation
        ) {
            if (DEBUG) console.warn("❌ Missing student info.");
            return res.status(400).json({
                status: false,
                message:
                    "Each student must have a name, date of birth, and medical information.",
            });
        }

        student.className = classData.className;
        student.startTime = classData.startTime;
        student.endTime = classData.endTime;

        const parents = [
            ...(student.parents || []),
            ...(student.secondParentDetails ? [student.secondParentDetails] : []),
        ];

        for (const parent of parents) {
            const email = parent?.parentEmail?.trim()?.toLowerCase();
            if (!email || !parent.parentFirstName || !parent.parentPhoneNumber) {
                if (DEBUG) console.warn("❌ Missing parent info.");
                return res.status(400).json({
                    status: false,
                    message: "Each parent must have a name, email, and phone number.",
                });
            }

            if (emailMap.has(email)) continue;

            const exists = await Admin.findOne({ where: { email } });
            if (exists) {
                if (DEBUG) console.warn(`⚠️ Duplicate email found: ${email}`);
                duplicateEmails.push(email);
            } else {
                emailMap.set(email, parent);
            }
        }
    }

    if (duplicateEmails.length > 0) {
        const unique = [...new Set(duplicateEmails)]; // remove duplicates
        const message =
            unique.length === 1
                ? `${unique[0]} email already in use.`
                : `${unique.join(", ")} emails already in use.`;

        if (DEBUG) console.warn("❌ Duplicate email(s) found.");
        await logActivity(req, PANEL, MODULE, "create", { message }, false);

        return res.status(409).json({ status: false, message });
    }

    try {
        if (DEBUG) console.log("🚀 Creating booking...");

        const leadId = req.params.leadId || null;
        const result = await WaitingListService.createBooking(formData, {
            source: "open", // 🔥 force open booking
            leadId,
        });

        if (!result.status) {
            if (DEBUG) console.error("❌ Booking service error:", result.message);
            await logActivity(req, PANEL, MODULE, "create", result, false);
            return res.status(500).json({ status: false, message: result.message });
        }

        const booking = result.data.booking;
        const studentId = result.data.studentId;
        // Send confirmation email to parents
        const parentMetas = await BookingParentMeta.findAll({
            where: { studentId },
        });

        if (parentMetas && parentMetas.length > 0) {
            const {
                status: configStatus,
                emailConfig,
                htmlTemplate,
                subject,
            } = await emailModel.getEmailConfig(PANEL, "waiting-list");

            if (configStatus && htmlTemplate) {
                const recipients = parentMetas.map((p) => ({
                    name: `${p.parentFirstName} ${p.parentLastName}`,
                    email: p.parentEmail,
                }));

                // Fetch ALL students for the booking trial
                const students = await BookingStudentMeta.findAll({
                    where: { bookingTrialId: booking.id },
                });
                const studentsHtml = students.length
                    ? students
                        .map(
                            (s) =>
                                `<p style="margin:0; font-size:13px; color:#5F5F6D;">
             ${s.studentFirstName} ${s.studentLastName}
           </p>`
                        )
                        .join("")
                    : `<p style="margin:0; font-size:13px; color:#5F5F6D;">N/A</p>`;

                for (const recipient of recipients) {
                    const variables = {
                        "{{studentsHtml}}": studentsHtml,
                        "{{parentName}}": recipient.name,
                        "{{parentEmail}}": recipient.email,
                        "{{parentPassword}}": "Synco123",
                        "{{venueName}}": venue?.name || "N/A",
                        "{{className}}": classData?.className || "N/A",
                        "{{startDate}}": booking?.startDate || "",
                        "{{classTime}}": classData?.startTime || "",
                        "{{appName}}": "Synco",
                        "{{year}}": new Date().getFullYear().toString(),
                        "{{logoUrl}}":
                            "https://webstepdev.com/demo/syncoUploads/syncoLogo.png",
                        "{{kidsPlaying}}":
                            "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png",
                    };

                    let finalHtml = htmlTemplate;
                    for (const [key, val] of Object.entries(variables)) {
                        finalHtml = finalHtml.replace(new RegExp(key, "g"), val);
                    }

                    await sendEmail(emailConfig, {
                        recipient: [recipient],
                        cc: emailConfig.cc || [],
                        bcc: emailConfig.bcc || [],
                        subject,
                        htmlBody: finalHtml,
                    });
                }
            }
        }

        if (DEBUG) console.log("📝 Logging activity...");
        await logActivity(req, PANEL, MODULE, "create", result, true);

        if (DEBUG) console.log("🔔 Creating notification...");
        await createNotification(
            req,
            "New Booking Created For Waiting List",
            `Booking "${classData.className}" has been scheduled on ${formData.startDate} from ${classData.startTime} to ${classData.endTime}.`,
            "System"
        );

        if (DEBUG) console.log("✅ Booking created successfully.");
        return res.status(201).json({
            status: true,
            message: "Booking created successfully. Confirmation email sent.",
            data: booking,
        });
    } catch (error) {
        if (DEBUG) console.error("❌ Booking creation error:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { error: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};