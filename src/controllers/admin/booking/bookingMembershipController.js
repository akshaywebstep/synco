const { validateFormData } = require("../../../utils/validateFormData");
const BookingMembershipService = require("../../../services/admin/booking/bookingMembership");
const { logActivity } = require("../../../utils/admin/activityLogger");

const {
  sequelize,
  Venue,
  ClassSchedule,
  BookingParentMeta,
  BookingStudentMeta,
  Booking,
  BookingEmergencyMeta,
} = require("../../../models");
const bookingService = require("../../../services/admin/booking/bookingMembership");

const emailModel = require("../../../services/email");
const sendEmail = require("../../../utils/email/sendEmail");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const PaymentPlan = require("../../../services/admin/payment/paymentPlan");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "book-paid-trial";

// Controller: Create Booking (Paid )

exports.createBooking = async (req, res) => {
  try {
    const formData = req.body;
    let paymentPlan;
    const paymentData = formData.payment || {};
    const price = Number(paymentData.price ?? 0); // Convert to number, default 0

    if (isNaN(price) || price <= 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid price value. Price must be greater than 0.",
      });
    }

    // ✅ Check class
    const classData = await ClassSchedule.findByPk(formData.classScheduleId);
    if (!classData)
      return res
        .status(404)
        .json({ status: false, message: "Class not found." });

    // ✅ Check capacity
    if (classData.capacity < formData.totalStudents) {
      return res.status(400).json({
        status: false,
        message: `Only ${classData.capacity} slot(s) left for this class.`,
      });
    }

    // ✅ Validate form
    const { isValid, error } = validateFormData(formData, {
      requiredFields: ["startDate", "totalStudents", "classScheduleId"],
    });
    if (!isValid) {
      await logActivity(req, PANEL, MODULE, "create", error, false);
      return res.status(400).json({ status: false, ...error });
    }

    if (!Array.isArray(formData.students) || formData.students.length === 0) {
      return res
        .status(400)
        .json({ status: false, message: "At least one student is required." });
    }
    const isFromWebsite = req.source === "open";
    // ✅ Inject venue
    formData.venueId = classData.venueId;

    let skipped = [];
    const adminId = req.admin?.id || null;

    // 🔹 Super admin only applies for admin-panel bookings
    let superAdminId = null;
    if (!isFromWebsite && adminId) {
      const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
      superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
    }

    const paymentPlanId = formData.paymentPlanId;

    // 🔹 Fetch payment plan for BOTH flows (needed for email)
    if (paymentPlanId) {
      let planCheck;

      if (isFromWebsite) {
        // ✅ PUBLIC lookup (no admin scope)
        planCheck = await PaymentPlan.getPublicPlanById(paymentPlanId);
      } else {
        // ✅ ADMIN scoped lookup
        planCheck = await PaymentPlan.getPlanById(paymentPlanId, superAdminId);
      }

      // ❌ Block admin if invalid
      if (!isFromWebsite && !planCheck.data) {
        return res.status(400).json({
          status: false,
          message: planCheck.message,
        });
      }

      // 🔹 Website flow → allow booking but still use plan if exists
      paymentPlan = planCheck.data || null;

      let incomingGatewayResponse =
        formData.paymentResponse || formData.gatewayResponse || null;

      if (typeof incomingGatewayResponse === "string") {
        try {
          incomingGatewayResponse = JSON.parse(incomingGatewayResponse);
        } catch { }
      }

      formData.paymentResponse = incomingGatewayResponse;
      formData.gatewayResponse = incomingGatewayResponse;
    }

    const leadId = req.params.leadId || null;

    // 🔹 Step 1: Create Booking + Students + Parents (Service)
    const result = await BookingMembershipService.createBooking(
      {
        ...formData,
        price, // 👈 ADD THIS
      },
      {
        source: req.source,
        adminId: req.admin?.id || null,
        leadId,
      }
    );

    // const result = await BookingMembershipService.createBooking(formData, {
    //   source: req.source,
    //   adminId: req.admin?.id || null,
    //   leadId,
    // });
    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "create", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const booking = result.data.booking;
    const studentIds = result.data.studentIds || [result.data.studentId]; // support multiple students

    // 🔹 Step 2: Fetch venue for email
    const venue = await Venue.findByPk(classData.venueId);
    const venueName = venue?.venueName || venue?.name || "N/A";

    // let paymentPlanType;

    // if (paymentPlan.interval.toLowerCase() === "month") {
    //   if (parseInt(paymentPlan.duration, 10) === 1) {
    //     paymentPlanType = "1-month";
    //   } else if (parseInt(paymentPlan.duration, 10) === 6) {
    //     paymentPlanType = "6-month";
    //   } else if (parseInt(paymentPlan.duration, 10) === 12) {
    //     paymentPlanType = "12-month";
    //   }
    // } else if (paymentPlan.interval.toLowerCase() === "quarter") {
    //   if (parseInt(paymentPlan.duration, 10) === 1) {
    //     paymentPlanType = "1-quarter";
    //   } else if (parseInt(paymentPlan.duration, 10) === 6) {
    //     paymentPlanType = "6-quarter";
    //   } else if (parseInt(paymentPlan.duration, 10) === 12) {
    //     paymentPlanType = "12-quarter";
    //   }
    // } else if (paymentPlan.interval.toLowerCase() === "year") {
    //   if (parseInt(paymentPlan.duration, 10) === 1) {
    //     paymentPlanType = "1-year";
    //   } else if (parseInt(paymentPlan.duration, 10) === 6) {
    //     paymentPlanType = "6-year";
    //   } else if (parseInt(paymentPlan.duration, 10) === 12) {
    //     paymentPlanType = "12-year";
    //   }
    // }

    let paymentPlanType = null;

    // 🔹 Normalize paymentPlan (handles Sequelize + nesting)
    const normalizedPlan =
      paymentPlan?.dataValues ||
      paymentPlan?.plan ||
      paymentPlan ||
      null;

    console.log("🧾 Normalized paymentPlan:", normalizedPlan);

    if (normalizedPlan?.interval && normalizedPlan?.duration) {
      const interval = String(normalizedPlan.interval).toLowerCase();
      const duration = parseInt(normalizedPlan.duration, 10);

      if (["month", "quarter", "year"].includes(interval) && duration > 0) {
        paymentPlanType = `${duration}-${interval}`;
      }
    }

    console.log("➡️ paymentPlanType =", paymentPlanType);

    console.log("➡️ Entered email sending block");
    console.log("paymentPlanType =", paymentPlanType);

    if (paymentPlanType) {
      console.log("✔️ paymentPlanType is truthy. Proceeding...");

      // 🔹 Step 3: Fetch email template (book-paid-trial)
      console.log("➡️ Fetching email config for 'book-paid-trial'...");
      const {
        status: configStatus,
        emailConfig,
        htmlTemplate,
        subject,
      } = await emailModel.getEmailConfig(PANEL, "book-paid-trial");

      console.log("configStatus:", configStatus);
      console.log("emailConfig:", emailConfig);
      console.log("htmlTemplate exists?", !!htmlTemplate);
      console.log("subject:", subject);

      if (configStatus && htmlTemplate) {
        console.log("✔️ Email template loaded successfully.");
        console.log("studentIds:", studentIds);

        for (const sId of studentIds) {
          console.log("\n---------------------------------------------");
          console.log("➡️ Processing studentId:", sId);

          const parentMetas = await BookingParentMeta.findAll({
            where: { studentId: sId },
          });

          console.log("parentMetas count:", parentMetas.length);

          if (!parentMetas.length) {
            console.log("⚠️ No parentMetas found. Skipping student:", sId);
            continue;
          }

          // Get the first parent only
          const firstParent = parentMetas[0];
          if (!firstParent || !firstParent.parentEmail) {
            console.log(
              "⚠️ First parent missing email. Skipping student:",
              sId
            );
            continue;
          }

          // Get ALL students for this parent
          const allStudents = await BookingStudentMeta.findAll({
            where: { bookingTrialId: booking.id },
          });

          // Build HTML list of ALL students
          const studentsHtml = allStudents.length
            ? allStudents
              .map(
                (s) =>
                  `<p style="margin:0; font-size:13px; color:#5F5F6D;">${s.studentFirstName} ${s.studentLastName}</p>`
              )
              .join("")
            : `<p style="margin:0; font-size:13px; color:#5F5F6D;">N/A</p>`;

          console.log("Generated studentsHtml length:", studentsHtml.length);

          try {
            let htmlBody = htmlTemplate
              .replace(
                /{{parentName}}/g,
                `${firstParent.parentFirstName} ${firstParent.parentLastName}`
              )
              .replace(/{{venueName}}/g, venueName)
              .replace(/{{className}}/g, classData?.className || "N/A")
              .replace(
                /{{classTime}}/g,
                `${classData?.startTime} - ${classData?.endTime}`
              )
              .replace(/{{startDate}}/g, booking?.startDate || "")
              .replace(/{{parentEmail}}/g, firstParent.parentEmail || "")
              .replace(/{{parentPassword}}/g, "Synco123")
              .replace(/{{appName}}/g, "Synco")
              .replace(/{{year}}/g, new Date().getFullYear().toString())
              .replace(/{{studentsHtml}}/g, studentsHtml)
              .replace(
                /{{logoUrl}}/g,
                "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
              )
              .replace(
                /{{kidsPlaying}}/g,
                "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
              );

            console.log("Generated htmlBody length:", htmlBody.length);

            try {
              const emailResp = await sendEmail(emailConfig, {
                recipient: [
                  {
                    name: `${firstParent.parentFirstName} ${firstParent.parentLastName}`,
                    email: firstParent.parentEmail,
                  },
                ],
                subject,
                htmlBody,
              });

              console.log(
                "📧 Email sent successfully to first parent:",
                firstParent.parentEmail,
                emailResp
              );
            } catch (err) {
              console.error("Failed to send email:", err.message);
            }
            
          } catch (err) {
            console.error(
              `❌ Failed to send email to ${firstParent.parentEmail}:`,
              err.message
            );
          }
        }
      }
    } else {
      console.log("❌ paymentPlanType is falsy. Skipping email sending block.");
    }
    // 🔹 Step 4: Notifications & Logging
    if (!isFromWebsite && adminId) {
      await createNotification(
        req,
        "New Booking Created",
        `Booking "${classData.className}" scheduled on ${formData.startDate}`,
        "System"
      );
    }
    await logActivity(req, PANEL, MODULE, "create", result, true);

    return res.status(201).json({
      status: true,
      message: "Booking created successfully. Confirmation email sent.",
      data: booking,
    });
  } catch (error) {
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

// exports.createBooking = async (req, res) => {
//   const formData = req.body;
//   let paymentPlan;
//   try {
//     // ✅ Check class
//     const classData = await ClassSchedule.findByPk(formData.classScheduleId);
//     if (!classData)
//       return res
//         .status(404)
//         .json({ status: false, message: "Class not found." });

//     // ✅ Check capacity
//     if (classData.capacity < formData.totalStudents) {
//       return res.status(400).json({
//         status: false,
//         message: `Only ${classData.capacity} slot(s) left for this class.`,
//       });
//     }
//     // if (!classWithVenue || !classWithVenue.venue) {
//     //   return res.status(400).json({
//     //     status: false,
//     //     message: "Invalid class or venue.",
//     //   });
//     // }

//     // // 🔹 Validate venue term groups
//     // const termGroupIds = classWithVenue.venue.termGroupId;

//     // if (!Array.isArray(termGroupIds) || termGroupIds.length === 0) {
//     //   return res.status(400).json({
//     //     status: false,
//     //     message: "Venue is not linked to any term groups.",
//     //   });
//     // }

//     // // 🔹 Fetch terms for venue
//     // const terms = await Term.findAll({
//     //   where: {
//     //     termGroupId: {
//     //       [Op.in]: termGroupIds,
//     //     },
//     //   },
//     // });

//     // if (!terms.length) {
//     //   return res.status(400).json({
//     //     status: false,
//     //     message: "No terms found for this venue.",
//     //   });
//     // }

//     // // 🔹 Count sessions passed in last 1 month
//     // const today = new Date();
//     // const oneMonthAgo = new Date();
//     // oneMonthAgo.setMonth(today.getMonth() - 1);

//     // let passedSessions = 0;

//     // for (const term of terms) {
//     //   if (!Array.isArray(term.sessionsMap)) continue;

//     //   for (const session of term.sessionsMap) {
//     //     if (!session.sessionDate) continue;

//     //     const sessionDate = new Date(session.sessionDate);

//     //     if (sessionDate < today && sessionDate >= oneMonthAgo) {
//     //       passedSessions++;
//     //     }
//     //   }
//     // }

//     // // 🔹 FINAL RULE (change threshold if needed)
//     // if (passedSessions > 0) {
//     //   return res.status(400).json({
//     //     status: false,
//     //     message: `Booking not allowed. ${passedSessions} session(s) already passed in the last month.`,
//     //   });
//     // }

//     // ✅ Validate form
//     const { isValid, error } = validateFormData(formData, {
//       requiredFields: ["startDate", "totalStudents", "classScheduleId"],
//     });
//     if (!isValid) {
//       await logActivity(req, PANEL, MODULE, "create", error, false);
//       return res.status(400).json({ status: false, ...error });
//     }

//     if (!Array.isArray(formData.students) || formData.students.length === 0) {
//       return res
//         .status(400)
//         .json({ status: false, message: "At least one student is required." });
//     }
//     const isFromWebsite = req.source === "open";
//     // ✅ Inject venue
//     formData.venueId = classData.venueId;

//     let skipped = [];
//     const adminId = req.admin?.id || null;

//     // 🔹 Super admin only applies for admin-panel bookings
//     let superAdminId = null;
//     if (!isFromWebsite && adminId) {
//       const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId);
//       superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;
//     }

//     const paymentPlanId = formData.paymentPlanId;

//     // 🔹 Fetch payment plan for BOTH flows (needed for email)
//     if (paymentPlanId) {
//       let planCheck;

//       if (isFromWebsite) {
//         // ✅ PUBLIC lookup (no admin scope)
//         planCheck = await PaymentPlan.getPublicPlanById(paymentPlanId);
//       } else {
//         // ✅ ADMIN scoped lookup
//         planCheck = await PaymentPlan.getPlanById(paymentPlanId, superAdminId);
//       }

//       // ❌ Block admin if invalid
//       if (!isFromWebsite && !planCheck.data) {
//         return res.status(400).json({
//           status: false,
//           message: planCheck.message,
//         });
//       }

//       // 🔹 Website flow → allow booking but still use plan if exists
//       paymentPlan = planCheck.data || null;

//       let incomingGatewayResponse =
//         formData.paymentResponse || formData.gatewayResponse || null;

//       if (typeof incomingGatewayResponse === "string") {
//         try {
//           incomingGatewayResponse = JSON.parse(incomingGatewayResponse);
//         } catch { }
//       }

//       formData.paymentResponse = incomingGatewayResponse;
//       formData.gatewayResponse = incomingGatewayResponse;
//     }

//     const leadId = req.params.leadId || null;

//     // 🔹 Step 1: Create Booking + Students + Parents (Service)
//     const result = await BookingMembershipService.createBooking(formData, {
//       source: req.source,
//       adminId: req.admin?.id || null,
//       leadId,
//     });
//     if (!result.status) {
//       await logActivity(req, PANEL, MODULE, "create", result, false);
//       return res.status(500).json({ status: false, message: result.message });
//     }

//     const booking = result.data.booking;
//     const studentIds = result.data.studentIds || [result.data.studentId]; // support multiple students

//     // 🔹 Step 2: Fetch venue for email
//     const venue = await Venue.findByPk(classData.venueId);
//     const venueName = venue?.venueName || venue?.name || "N/A";

//     // let paymentPlanType;

//     // if (paymentPlan.interval.toLowerCase() === "month") {
//     //   if (parseInt(paymentPlan.duration, 10) === 1) {
//     //     paymentPlanType = "1-month";
//     //   } else if (parseInt(paymentPlan.duration, 10) === 6) {
//     //     paymentPlanType = "6-month";
//     //   } else if (parseInt(paymentPlan.duration, 10) === 12) {
//     //     paymentPlanType = "12-month";
//     //   }
//     // } else if (paymentPlan.interval.toLowerCase() === "quarter") {
//     //   if (parseInt(paymentPlan.duration, 10) === 1) {
//     //     paymentPlanType = "1-quarter";
//     //   } else if (parseInt(paymentPlan.duration, 10) === 6) {
//     //     paymentPlanType = "6-quarter";
//     //   } else if (parseInt(paymentPlan.duration, 10) === 12) {
//     //     paymentPlanType = "12-quarter";
//     //   }
//     // } else if (paymentPlan.interval.toLowerCase() === "year") {
//     //   if (parseInt(paymentPlan.duration, 10) === 1) {
//     //     paymentPlanType = "1-year";
//     //   } else if (parseInt(paymentPlan.duration, 10) === 6) {
//     //     paymentPlanType = "6-year";
//     //   } else if (parseInt(paymentPlan.duration, 10) === 12) {
//     //     paymentPlanType = "12-year";
//     //   }
//     // }

//     let paymentPlanType = null;

//     // 🔹 Normalize paymentPlan (handles Sequelize + nesting)
//     const normalizedPlan =
//       paymentPlan?.dataValues ||
//       paymentPlan?.plan ||
//       paymentPlan ||
//       null;

//     console.log("🧾 Normalized paymentPlan:", normalizedPlan);

//     if (normalizedPlan?.interval && normalizedPlan?.duration) {
//       const interval = String(normalizedPlan.interval).toLowerCase();
//       const duration = parseInt(normalizedPlan.duration, 10);

//       if (["month", "quarter", "year"].includes(interval) && duration > 0) {
//         paymentPlanType = `${duration}-${interval}`;
//       }
//     }

//     console.log("➡️ paymentPlanType =", paymentPlanType);

//     console.log("➡️ Entered email sending block");
//     console.log("paymentPlanType =", paymentPlanType);

//     if (paymentPlanType) {
//       console.log("✔️ paymentPlanType is truthy. Proceeding...");

//       // 🔹 Step 3: Fetch email template (book-paid-trial)
//       console.log("➡️ Fetching email config for 'book-paid-trial'...");
//       const {
//         status: configStatus,
//         emailConfig,
//         htmlTemplate,
//         subject,
//       } = await emailModel.getEmailConfig(PANEL, "book-paid-trial");

//       console.log("configStatus:", configStatus);
//       console.log("emailConfig:", emailConfig);
//       console.log("htmlTemplate exists?", !!htmlTemplate);
//       console.log("subject:", subject);

//       if (configStatus && htmlTemplate) {
//         console.log("✔️ Email template loaded successfully.");
//         console.log("studentIds:", studentIds);

//         for (const sId of studentIds) {
//           console.log("\n---------------------------------------------");
//           console.log("➡️ Processing studentId:", sId);

//           const parentMetas = await BookingParentMeta.findAll({
//             where: { studentId: sId },
//           });

//           console.log("parentMetas count:", parentMetas.length);

//           if (!parentMetas.length) {
//             console.log("⚠️ No parentMetas found. Skipping student:", sId);
//             continue;
//           }

//           // Get the first parent only
//           const firstParent = parentMetas[0];
//           if (!firstParent || !firstParent.parentEmail) {
//             console.log(
//               "⚠️ First parent missing email. Skipping student:",
//               sId
//             );
//             continue;
//           }

//           // Get ALL students for this parent
//           const allStudents = await BookingStudentMeta.findAll({
//             where: { bookingTrialId: booking.id },
//           });

//           // Build HTML list of ALL students
//           const studentsHtml = allStudents.length
//             ? allStudents
//               .map(
//                 (s) =>
//                   `<p style="margin:0; font-size:13px; color:#5F5F6D;">${s.studentFirstName} ${s.studentLastName}</p>`
//               )
//               .join("")
//             : `<p style="margin:0; font-size:13px; color:#5F5F6D;">N/A</p>`;

//           console.log("Generated studentsHtml length:", studentsHtml.length);

//           try {
//             let htmlBody = htmlTemplate
//               .replace(
//                 /{{parentName}}/g,
//                 `${firstParent.parentFirstName} ${firstParent.parentLastName}`
//               )
//               .replace(/{{venueName}}/g, venueName)
//               .replace(/{{className}}/g, classData?.className || "N/A")
//               .replace(
//                 /{{classTime}}/g,
//                 `${classData?.startTime} - ${classData?.endTime}`
//               )
//               .replace(/{{startDate}}/g, booking?.startDate || "")
//               .replace(/{{parentEmail}}/g, firstParent.parentEmail || "")
//               .replace(/{{parentPassword}}/g, "Synco123")
//               .replace(/{{appName}}/g, "Synco")
//               .replace(/{{year}}/g, new Date().getFullYear().toString())
//               .replace(/{{studentsHtml}}/g, studentsHtml)
//               .replace(
//                 /{{logoUrl}}/g,
//                 "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
//               )
//               .replace(
//                 /{{kidsPlaying}}/g,
//                 "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
//               );

//             console.log("Generated htmlBody length:", htmlBody.length);

//             const emailResp = await sendEmail(emailConfig, {
//               recipient: [
//                 {
//                   name: `${firstParent.parentFirstName} ${firstParent.parentLastName}`,
//                   email: firstParent.parentEmail,
//                 },
//               ],
//               subject,
//               htmlBody,
//             });

//             console.log(
//               "📧 Email sent successfully to first parent:",
//               firstParent.parentEmail,
//               emailResp
//             );
//           } catch (err) {
//             console.error(
//               `❌ Failed to send email to ${firstParent.parentEmail}:`,
//               err.message
//             );
//           }
//         }
//       }
//     } else {
//       console.log("❌ paymentPlanType is falsy. Skipping email sending block.");
//     }
//     // 🔹 Step 4: Notifications & Logging
//     if (!isFromWebsite && adminId) {
//       await createNotification(
//         req,
//         "New Booking Created",
//         `Booking "${classData.className}" scheduled on ${formData.startDate}`,
//         "System"
//       );
//     }
//     await logActivity(req, PANEL, MODULE, "create", result, true);

//     return res.status(201).json({
//       status: true,
//       message: "Booking created successfully. Confirmation email sent.",
//       data: booking,
//     });
//   } catch (error) {
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "create",
//       { error: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

exports.getAllPaidBookings = async (req, res) => {
  try {
    if (DEBUG) console.log("📥 Fetching all paid bookings...");

    const bookedBy = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(
      req.admin.id,
      true
    );
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

    // ✅ Build filters from query params
    const filters = {
      status: req.query.status,
      venueId: req.query.venueId,
      venueName: req.query.venueName,
      dateBooked: req.query.dateBooked,
      studentName: req.query.studentName,
      dateFrom: req.query.dateFrom || undefined,
      fromDate: req.query.fromDate || undefined,
      dateTo: req.query.dateTo || undefined,
      duration: req.query.duration,
      interval: req.query.interval ? req.query.interval.trim() : undefined,
      // bookedBy: req.query.bookedBy,
    };

    // ✅ Resolve bookedBy filter safely
    const bookedByQuery = req.query.bookedBy;
    const role = req.admin?.role?.toLowerCase();

    // ----------------------------------
    // CASE 1: bookedBy explicitly sent
    // ----------------------------------
    if (
      bookedByQuery !== undefined &&
      bookedByQuery !== null &&
      bookedByQuery !== ""
    ) {
      if (Array.isArray(bookedByQuery)) {
        filters.bookedBy = bookedByQuery.map(Number).filter(Boolean);
      } else {
        filters.bookedBy = bookedByQuery.split(",").map(Number).filter(Boolean);
      }
    }

    // ----------------------------------
    // CASE 2: bookedBy NOT sent → role-based default
    // ----------------------------------
    else {
      // ✅ SUPER ADMIN → self + child admins + website
      if (role === "super admin") {
        const childAdminIds = (mainSuperAdminResult?.admins || []).map(
          (a) => a.id
        );

        filters.bookedBy = {
          type: "super_admin",
          adminIds: [req.admin.id, ...childAdminIds],
        };
      }

      // ✅ ADMIN → self + super admin + website
      else if (role === "admin") {
        filters.bookedBy = {
          type: "admin",
          adminIds: [req.admin.id, mainSuperAdminResult?.superAdmin?.id].filter(
            Boolean
          ),
        };
      }

      // ✅ AGENT → only self
      else {
        filters.bookedBy = {
          type: "agent",
          adminIds: [req.admin.id],
        };
      }
    }

    const result = await BookingMembershipService.getAllBookingsWithStats(
      filters
    );

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "read", { filters }, true);

    return res.status(200).json({
      status: true,
      message: "Paid bookings retrieved successfully",
      data: result.data,
      stats: result.stats,
    });
  } catch (error) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.sendSelectedMemberEmail = async (req, res) => {
  const { bookingIds } = req.body;

  if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
    return res.status(400).json({
      status: false,
      message: "bookingIds (array) is required",
    });
  }

  try {
    const results = await Promise.all(
      bookingIds.map(async (bookingId) => {
        const result =
          await BookingMembershipService.sendActiveMemberSaleEmailToParents({
            bookingId,
          });

        await logActivity(
          req,
          PANEL,
          MODULE,
          "send",
          {
            message: `Email attempt for bookingId ${bookingId}: ${result.message}`,
          },
          result.status
        );

        return { bookingId, ...result };
      })
    );

    const allSentTo = results.flatMap((r) => r.sentTo || []);

    return res.status(200).json({
      status: true,
      message: `Emails processed for ${bookingIds.length} bookings`,
      results,
      sentTo: allSentTo,
    });
  } catch (error) {
    console.error("❌ Controller Send Email Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "send",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getAllPaidActiveBookings = async (req, res) => {
  try {
    console.log("🔹 Controller start: getAllPaidActiveBookings");

    const bookedBy = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(
      req.admin.id,
      true
    );
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;
    // Step 1: Prepare filters
    const filters = {
      status: req.query.status,
      venueId: req.query.venueId,
      venueName: req.query.venueName,
      dateBooked: req.query.dateBooked,
      studentName: req.query.studentName,
      duration: req.query.duration,
      planType: req.query.planType,
      bookedBy: req.query.bookedBy,
      // lifeCycle: req.query.lifeCycle,
      // flexiPlan: req.query.flexiPlan,
      dateFrom: req.query.dateFrom ? req.query.dateFrom : undefined,
      dateTo: req.query.dateTo ? req.query.dateTo : undefined,
      fromDate: req.query.fromDate ? req.query.fromDate : undefined, // ✅ added
      toDate: req.query.toDate ? req.query.toDate : undefined, // ✅ added
    };
    console.log("🔹 Filters prepared:", filters);

    if (req.query.bookedBy) {
      let bookedByParam = req.query.bookedBy;

      // If multiple query params → array
      if (Array.isArray(bookedByParam)) {
        filters.bookedBy = bookedByParam.map(Number);

        // If single param → string
      } else {
        filters.bookedBy = bookedByParam.split(",").map(Number);
      }

    } else if (req.admin?.role?.toLowerCase() === "super admin") {

      const childAdminIds = (mainSuperAdminResult?.admins || [])
        .map((a) => a.id);

      filters.bookedBy = [
        req.admin.id,        // ✅ include Super Admin
        ...childAdminIds,    // ✅ include child admins
      ];

    }
    else {

      filters.bookedBy = [req.admin.id];

    }

    // Step 2: Call service
    const result = await BookingMembershipService.getActiveMembershipBookings(
      filters
    );
    console.log("🔹 Service result received:", result);

    // Step 3: Check result status
    if (!result.status) {
      console.error("❌ Service failed:", result.message);
      return res.status(500).json({ status: false, message: result.message });
    }

    // Step 4: Log activity
    await logActivity(req, PANEL, MODULE, "read", { filters }, true);
    console.log("🔹 Activity logged successfully");

    // Step 5: Return response
    console.log("🔹 Returning response with data count:", result.data.length);
    return res.status(200).json({
      status: true,
      message: "Paid bookings retrieved successfully",
      data: result.data,
      stats: result.stats,
    });
  } catch (error) {
    console.error("❌ Controller error:", error.message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.sendActiveSelectedMemberEmail = async (req, res) => {
  const { bookingIds } = req.body;

  if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
    return res.status(400).json({
      status: false,
      message: "bookingIds (array) is required",
    });
  }

  if (DEBUG) {
    console.log("📨 Sending Emails for bookingIds:", bookingIds);
  }

  try {
    const allSentTo = [];

    for (const bookingId of bookingIds) {
      // Call service for each bookingId
      const result =
        await BookingMembershipService.sendActiveMemberSaleEmailToParents({
          bookingId,
        });

      if (!result.status) {
        await logActivity(req, PANEL, MODULE, "send", result, false);
        return res.status(500).json({
          status: false,
          message: result.message,
          error: result.error,
        });
      }

      allSentTo.push(...result.sentTo);

      await logActivity(
        req,
        PANEL,
        MODULE,
        "send",
        {
          message: `Email sent for bookingId ${bookingId}`,
        },
        true
      );
    }

    return res.status(200).json({
      status: true,
      message: `Emails sent for ${bookingIds.length} bookings`,
      sentTo: allSentTo, // combined array of all parent emails
    });
  } catch (error) {
    console.error("❌ Controller Send Email Error:", error);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "send",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.transferClass = async (req, res) => {
  const formData = req.body;

  try {
    if (!formData.bookingId || !formData.classScheduleId) {
      return res.status(400).json({
        status: false,
        message: "Booking ID and new class schedule are required.",
      });
    }

    const classData = await ClassSchedule.findByPk(formData.classScheduleId);
    if (!classData) {
      return res
        .status(404)
        .json({ status: false, message: "New class not found." });
    }

    if (classData.capacity <= 0) {
      return res.status(400).json({
        status: false,
        message: `No slots left in the new class "${classData.className}".`,
      });
    }

    // ✅ If venue not passed, take from class
    if (!formData.venueId) {
      formData.venueId = classData.venueId;
    }

    // 🔹 Call Service
    const result = await BookingMembershipService.transferClass(formData, {
      adminId: req.admin?.id || null,
    });

    if (!result.status) {
      await logActivity(req, PANEL, MODULE, "transfer", result, false);
      return res.status(500).json({ status: false, message: result.message });
    }

    const venue = await Venue.findByPk(formData.venueId);
    const venueName = venue?.venueName || venue?.name || "N/A";

    await createNotification(
      req,
      "Booking Transferred",
      `Booking transferred to class "${classData.className}" at venue "${venueName}"`,
      "System"
    );

    await logActivity(req, PANEL, MODULE, "transfer", result, true);

    return res.status(200).json({
      status: true,
      message: "Class transferred successfully.",
      data: result.data,
    });
  } catch (error) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "transfer",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.addToWaitingList = async (req, res) => {
  try {
    console.log("🚀 [Controller] addToWaitingList started");

    const adminId = req.admin?.id;
    const data = req.body;

    // 🔹 Validate admin
    if (!adminId) {
      console.warn("⚠️ [Controller] Admin not found in request");
      return res
        .status(400)
        .json({ status: false, message: "Admin is required.", data: null });
    }
    console.log("✅ [Controller] Admin validated:", adminId);

    // 🔹 Validate class schedule
    if (!data.classScheduleId) {
      console.warn("⚠️ [Controller] Missing classScheduleId in payload");
      return res.status(400).json({
        status: false,
        message: "Class schedule is required.",
        data: null,
      });
    }

    // ✅ Call service to update booking to waiting list
    console.log("🔍 [Controller] Calling service addToWaitingListService");
    const result = await BookingMembershipService.addToWaitingListService(
      data,
      adminId
    );

    if (!result.status) {
      console.warn("⚠️ [Controller] Service failed:", result.message);
      return res.status(400).json(result);
    }

    const waitingBooking = result.data;
    console.log(
      "✅ [Controller] Booking updated to waiting list:",
      waitingBooking.id
    );

    // ✅ Create notification (outside of transaction)
    console.log("🔔 [Controller] Creating notification");
    await createNotification(
      req,
      "Booking Added to Waiting List",
      `Booking added to waiting list `,
      "System"
    );

    // ✅ Log activity
    console.log("📝 [Controller] Logging activity");
    await logActivity(
      req,
      PANEL,
      MODULE,
      "add_to_waiting_list",
      waitingBooking,
      true
    );

    console.log("🎉 [Controller] Operation completed successfully");
    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ [Controller] addToWaitingList error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error.",
      data: null,
    });
  }
};

exports.getWaitingList = async (req, res) => {
  try {
    const result = await BookingMembershipService.getWaitingList();

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    return res.status(200).json({
      status: true,
      message: "Waiting list fetched successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getWaitingList controller error:", error);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getBookingsById = async (req, res) => {
  try {
    const { bookingId } = req.params; // ✅ get bookingId from URL params
    const result = await BookingMembershipService.getBookingsById(bookingId);

    if (!result.status) {
      return res.status(500).json({ status: false, message: result.message });
    }

    await logActivity(req, PANEL, MODULE, "read", {}, true);

    return res.status(200).json({
      status: true,
      message: "Paid booking retrieved successfully",
      data: result.data,
      totalPaidBookings: result.totalPaidBookings,
    });
  } catch (error) {
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};

exports.updateBooking = async (req, res) => {
  if (DEBUG) console.log("🔹 Step 0: Controller entered");

  const bookingId = req.params?.bookingId;
  const studentsPayload = req.body?.students || [];
  const adminId = req.admin?.id;

  // ✅ Security check
  if (!adminId) {
    if (DEBUG) console.warn("❌ Unauthorized access attempt");
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }

  if (!bookingId) {
    if (DEBUG) console.warn("❌ Booking ID missing in URL");
    return res.status(400).json({
      status: false,
      message: "Booking ID is required in URL (params.bookingId).",
    });
  }

  const t = await sequelize.transaction();

  try {
    if (DEBUG)
      console.log("🔹 Step 1: Calling service to update booking + students");

    // Call service
    const updateResult = await bookingService.updateBookingWithStudents(
      bookingId,
      studentsPayload,
      t
    );

    await t.commit();
    if (DEBUG) console.log("✅ Step 2: Transaction committed successfully");

    // Log activity
    if (DEBUG) console.log("🔹 Step 3: Logging activity");
    await logActivity(
      req,
      "admin",
      "book-membership",
      "update",
      {
        message: `Updated student, parent, and emergency data for booking ID: ${bookingId}`,
      },
      true
    );

    // Create notification
    if (DEBUG) console.log("🔹 Step 4: Creating notification");
    await createNotification(
      req,
      "Booking Updated",
      `Student, parent, and emergency data updated`,
      "System"
    );

    if (DEBUG) console.log("✅ Step 5: Controller finished successfully");

    return res.status(200).json({
      status: updateResult.status,
      message: updateResult.message,
      data: updateResult.data || null,
    });
  } catch (error) {
    if (!t.finished) await t.rollback();
    if (DEBUG) console.error("❌ updateBooking Error:", error.message);
    return res.status(500).json({
      status: false,
      message: error.message || "Failed to update booking",
    });
  }
};

exports.retryBookingPayment = async (req, res) => {
  console.log("🔹 [Controller] Retry booking payment request received");
  const { bookingId } = req.params;
  console.log(
    "🔎 bookingId from req.params:",
    bookingId,
    "type:",
    typeof bookingId
  );
  const formData = req.body;

  try {
    console.log("🔹 [Controller] Looking up booking:", bookingId);
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      console.log("❌ [Controller] Booking not found");
      return res
        .status(404)
        .json({ status: false, message: "Booking not found." });
    }
    console.log("✅ [Controller] Booking found:", booking.id);

    console.log("🔹 [Controller] Validating form data...");
    const { isValid, error } = validateFormData(formData, {
      requiredFields: ["payment"],
    });
    if (!isValid) {
      console.log("❌ [Controller] Validation failed:", error);
      await logActivity(req, PANEL, MODULE, "retry", error, false);
      return res.status(400).json({ status: false, ...error });
    }
    console.log("✅ [Controller] Validation passed");

    console.log("🔹 [Controller] Calling service retryBookingPayment...");
    const result = await BookingMembershipService.retryBookingPayment(
      bookingId,
      formData
    );
    console.log("✅ [Controller] Service response:", result);

    if (!result.status) {
      console.log("❌ [Controller] Retry failed:", result.message);
      await logActivity(req, PANEL, MODULE, "retry", result, false);
      return res.status(400).json({ status: false, message: result.message });
    }

    console.log("🔹 [Controller] Fetching class & venue details...");
    const classData = await ClassSchedule.findByPk(booking.classScheduleId);
    const venue = await Venue.findByPk(booking.venueId);
    const venueName = venue?.venueName || venue?.name || "N/A";
    console.log("✅ [Controller] Class & venue loaded");

    if (result.paymentStatus === "paid") {
      console.log(
        "🔹 [Controller] Payment successful, sending confirmation emails..."
      );
      const {
        status: configStatus,
        emailConfig,
        htmlTemplate,
        subject,
      } = await emailModel.getEmailConfig(PANEL, "book-paid-trial");

      if (configStatus && htmlTemplate) {
        const studentId = result.studentId || booking.studentId; // 👈 FIX
        if (!studentId) {
          console.warn("⚠️ No studentId found, skipping parent email sending.");
        } else {
          const parentMetas = await BookingParentMeta.findAll({
            where: { studentId },
          });
          console.log("✅ [Controller] ParentMetas found:", parentMetas.length);

          for (const p of parentMetas) {
            try {
              let htmlBody = htmlTemplate;
              // ... replace placeholders ...
              console.log("📤 [Controller] Sending email to:", p.parentEmail);
              await sendEmail(emailConfig, {
                recipient: [
                  {
                    name: `${p.parentFirstName} ${p.parentLastName}`,
                    email: p.parentEmail,
                  },
                ],
                subject,
                htmlBody,
              });
              console.log("✅ [Controller] Email sent to:", p.parentEmail);
            } catch (err) {
              console.error(
                `❌ [Controller] Failed to send retry email to ${p.parentEmail}:`,
                err.message
              );
            }
          }
        }
      }
    }

    console.log("🔹 [Controller] Creating notification & logging activity...");
    await createNotification(
      req,
      "Booking Payment Retry",
      `Booking "${classData?.className}" retried with status: ${result.paymentStatus}`,
      "System"
    );
    await logActivity(req, PANEL, MODULE, "retry", result, true);
    console.log("✅ [Controller] Notification & log created");

    return res.status(200).json({
      status: true,
      message: `Booking payment retried successfully. Status: ${result.paymentStatus}`,
      data: result,
    });
  } catch (error) {
    console.error("❌ [Controller] Server error:", error.message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "retry",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

exports.listFailedPayments = async (req, res) => {
  const { bookingId } = req.params;

  try {
    const failedPayments =
      await BookingMembershipService.getFailedPaymentsByBookingId(bookingId);

    if (!failedPayments.length) {
      return res.status(404).json({
        status: false,
        message: "No failed payments found for this booking.",
        data: [],
      });
    }

    res.status(200).json({
      status: true,
      message: "Failed payments fetched successfully.",
      data: failedPayments,
    });
  } catch (error) {
    console.error("Error fetching failed payments:", error);
    res.status(500).json({
      status: false,
      message: error.message || "Internal server error",
    });
  }
};
