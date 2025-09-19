const {
  CancelSession,
  ClassSchedule,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  Admin,
  EmailConfig,
  Term,
  SessionPlanGroup,
  Venue,
} = require("../../../models");
const { Op } = require("sequelize");
const sendEmail = require("../../../utils/email/sendEmail");

exports.createCancellationRecord = async (
  classScheduleId,
  cancelData,
  adminId
) => {
  try {
    const targetSessionPlanId = cancelData.targetSessionPlanId; // ✅ FIX
    console.log("🎯 Cancelling only sessionPlanId:", targetSessionPlanId);
    // Step 1: Fetch class schedule with venue
    const classSchedule = await ClassSchedule.findByPk(classScheduleId, {
      include: [{ model: Venue, as: "venue" }],
    });
    if (!classSchedule) return { status: false, message: "Class not found." };

    // Step 2: Fetch bookings
    const bookings = await Booking.findAll({
      where: { classScheduleId },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [{ model: BookingParentMeta, as: "parents" }],
        },
      ],
    });

    // Step 3: Save cancellation record (always)
    const cancelEntry = await CancelSession.create({
      classScheduleId,
      reasonForCancelling: cancelData.reasonForCancelling,
      notifyMembers: cancelData.notifyMembers,
      creditMembers: cancelData.creditMembers,
      notifyTrialists: cancelData.notifyTrialists,
      notifyCoaches: cancelData.notifyCoaches,
      notifications: cancelData.notifications,
      createdBy: adminId,
      cancelledAt: new Date(),
    });

    // Step 4: Update related session plans (only targetSessionPlanId)
    if (classSchedule.venueId) {
      console.log("➡️ classSchedule.venueId:", classSchedule.venueId);

      const venue = await Venue.findByPk(classSchedule.venueId);
      console.log(
        "🏟 Venue found:",
        venue?.id,
        "termGroupId:",
        venue?.termGroupId
      );

      let termGroupIds = [];
      if (venue?.termGroupId) {
        termGroupIds = Array.isArray(venue.termGroupId)
          ? venue.termGroupId
          : JSON.parse(venue.termGroupId);
      }
      console.log("📌 termGroupIds:", termGroupIds);

      if (termGroupIds.length) {
        const terms = await Term.findAll({
          where: { termGroupId: { [Op.in]: termGroupIds } },
        });
        console.log(
          "📚 Found terms:",
          terms.map((t) => ({ id: t.id, name: t.termName }))
        );

        for (const term of terms) {
          console.log("🔎 Checking term:", term.id, term.termName);

          const sessions = Array.isArray(term.sessionsMap)
            ? term.sessionsMap
            : JSON.parse(term.sessionsMap);

          console.log("🗓 Sessions in term:", sessions);

          for (const session of sessions) {
            console.log("➡️ Checking session:", session);

            if (session.sessionPlanId) {
              if (session.sessionPlanId === targetSessionPlanId) {
                console.log("✅ Match found! Cancelling:", targetSessionPlanId);

                const sessionPlan = await SessionPlanGroup.findByPk(
                  session.sessionPlanId
                );
                if (sessionPlan) {
                  await sessionPlan.update({ status: "cancelled" });
                  console.log("✔️ sessionPlan updated:", sessionPlan.id);
                } else {
                  console.log(
                    "⚠️ No sessionPlan found for id:",
                    session.sessionPlanId
                  );
                }
              } else {
                console.log("⏭ Skipping sessionPlanId:", session.sessionPlanId);
              }
            }
          }
        }
      } else {
        console.log("⚠️ No termGroupIds found, skipping.");
      }
    } else {
      console.log("⚠️ No venueId in classSchedule, skipping.");
    }

    // Step 5: If no bookings → skip emails
    if (!bookings.length) {
      return {
        status: true,
        message:
          "Cancellation saved & terms updated. No bookings, so no emails sent.",
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
      message: "Cancellation saved, terms updated & emails sent.",
      data: cancelEntry,
    };
  } catch (error) {
    return { status: false, message: error.message };
  }
};

// exports.getAllCancelledSessions = async () => {
//   console.log("🛠 Service: getAllCancelledSessions called");

//   try {
//     const sessions = await CancelClass.findAll({
//       order: [["cancelledAt", "DESC"]],
//       include: [
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           include: [
//             {
//               model: Venue,
//               as: "venue", // full Venue data
//             },
//           ],
//         },
//       ],
//     });

//     if (!sessions.length) {
//       console.warn("⚠️ No cancelled sessions found");
//       return { status: false, message: "No cancelled sessions found." };
//     }

//     const formattedData = sessions.map((s) => {
//       const json = s.toJSON();

//       // Safely parse notifications
//       let notificationsArray = [];
//       if (Array.isArray(json.notifications)) {
//         notificationsArray = json.notifications;
//       } else if (typeof json.notifications === "string") {
//         try {
//           notificationsArray = JSON.parse(json.notifications);
//         } catch (err) {
//           notificationsArray = [];
//         }
//       }

//       return {
//         id: json.id,
//         classScheduleId: json.classScheduleId,
//         reasonForCancelling: json.reasonForCancelling,
//         notifyMembers: json.notifyMembers,
//         creditMembers: json.creditMembers,
//         notifyTrialists: json.notifyTrialists,
//         notifyCoaches: json.notifyCoaches,
//         cancelledAt: json.cancelledAt,
//         createdBy: json.createdBy,
//         notifications: notificationsArray.map((n) => ({
//           role: n.role,
//           subjectLine: n.subjectLine,
//           emailBody: n.emailBody,
//           deliveryMethod: n.deliveryMethod,
//           templateKey: n.templateKey,
//         })),
//         classSchedule: json.classSchedule || null, // full ClassSchedule + Venue
//       };
//     });

//     return { status: true, data: formattedData };
//   } catch (error) {
//     console.error("❌ getAllCancelledSessions Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };

// Step 4: Update SessionPlanGroup if Term.sessionsMap contains the sessionPlanId
// let updatedGroupsCount = 0;

// if (classSchedule.venueId) {
//   const venue = await Venue.findByPk(classSchedule.venueId);

//   // Get the termGroupIds linked to this venue
//   const termGroupIds = venue?.termGroupId
//     ? Array.isArray(venue.termGroupId)
//       ? venue.termGroupId
//       : JSON.parse(venue.termGroupId)
//     : [];

//   if (termGroupIds.length) {
//     // Fetch all terms under these termGroupIds
//     const terms = await Term.findAll({
//       where: { termGroupId: { [Op.in]: termGroupIds } },
//     });

//     const sessionPlanGroupIdsToUpdate = new Set();

//     for (const term of terms) {
//       // Parse the sessionsMap array
//       const sessionsMap = Array.isArray(term.sessionsMap)
//         ? term.sessionsMap
//         : JSON.parse(term.sessionsMap || "[]");

//       // If any session has the matching sessionPlanId
//       const matchingSession = sessionsMap.find(
//         (s) =>
//           Number(s.sessionPlanId) === Number(classSchedule.sessionPlanId)
//       );

//       if (matchingSession && term.sessionPlanGroupId) {
//         const groupIds = Array.isArray(term.sessionPlanGroupId)
//           ? term.sessionPlanGroupId
//           : JSON.parse(term.sessionPlanGroupId);
//         groupIds.forEach((id) => sessionPlanGroupIdsToUpdate.add(id));
//       }
//     }

//     // Update the SessionPlanGroup status
//     if (sessionPlanGroupIdsToUpdate.size) {
//       const sessionPlanGroups = await SessionPlanGroup.findAll({
//         where: { id: { [Op.in]: Array.from(sessionPlanGroupIdsToUpdate) } },
//       });

//       for (const group of sessionPlanGroups) {
//         await group.update({ status: "cancelled" });
//         updatedGroupsCount++;
//       }
//     }
//   }
// }

// // Optional: Return a message if nothing was updated
// if (updatedGroupsCount === 0) {
//   console.log("No SessionPlanGroup matched the sessionPlanId for update.");
// }

// // Step 5: If no bookings OR no session plan groups updated → skip emails
// if (!bookings.length && updatedGroupsCount === 0) {
//   return {
//     status: true,
//     message:
//       "Cancellation saved. No bookings & no session plan groups matched for update, so no emails sent.",
//     data: cancelEntry,
//   };
// }
