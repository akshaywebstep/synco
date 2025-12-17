const {
    HolidayCancelSession,
    HolidayClassSchedule,
    HolidayBooking,
    HolidayBookingStudentMeta,
    HolidayBookingParentMeta,
    Admin,
    EmailConfig,
    HolidayCampDates,
    HolidaySessionPlanGroup,
    HolidayVenue,
    HolidayClassScheduleCampDateMap,
} = require("../../../../models");
const { Op } = require("sequelize");
const sendEmail = require("../../../../utils/email/sendEmail");

exports.createCancellationRecord = async (
    classScheduleId,
    cancelData,
    adminId
) => {
    try {
        const targetMapId = cancelData.mapId; // ✅ expect HolidayClassScheduleCampDateMap id
        console.log("🎯 Cancelling HolidayClassScheduleCampDateMap id:", targetMapId);

        // Step 1: Fetch class schedule with venue
        const classSchedule = await HolidayClassSchedule.findByPk(classScheduleId, {
            include: [{ model: HolidayVenue, as: "venue" }],
        });
        if (!classSchedule) return { status: false, message: "Class not found." };

        // Step 2: Fetch bookings
        const bookings = await HolidayBooking.findAll({
            where: { classScheduleId },
            include: [
                {
                    model: HolidayBookingStudentMeta,
                    as: "students",
                    include: [{ model: HolidayBookingParentMeta, as: "parents" }],
                },
            ],
        });

        let sessionPlanId = 0;
        // Step 4: Update only the target HolidayClassScheduleCampDateMap
        if (targetMapId) {
            const mapEntry = await HolidayClassScheduleCampDateMap.findByPk(targetMapId);

            if (mapEntry) {
                console.log(`mapEntry - `, mapEntry);
                sessionPlanId = mapEntry.sessionPlanId;
                await mapEntry.update({ status: "cancelled" });
                console.log("✔️ HolidayClassScheduleCampDateMap cancelled:", mapEntry.id);
            } else {
                console.log("⚠️ No HolidayClassScheduleCampDateMap found for id:", targetMapId);
            }
        } else {
            console.log("⚠️ No mapId provided in request");
        }

        console.log(`sessionPlanId - `, sessionPlanId);
        // Step 3: Save cancellation record (always)
        const cancelEntry = await HolidayCancelSession.create({
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
                emailsSent: false, // ✅ IMPORTANT FLAG
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

        return {
            status: true,
            emailsSent: true, // ✅ IMPORTANT FLAG
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
        const session = await HolidayCancelSession.findByPk(id, {
            include: [
                {
                    model: HolidayClassSchedule,
                    as: "holidayClassSchedule",
                    include: [{ model: HolidayVenue, as: "venue" }],
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
            holidayClassSchedule: json.holidayClassSchedule || null,
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
        const session = await HolidayCancelSession.findOne({
            where: { mapId, sessionPlanGroupId },
            include: [
                {
                    model: HolidayClassSchedule,
                    as: "holidayClassSchedule",
                    include: [{ model: HolidayVenue, as: "venue" }],
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
