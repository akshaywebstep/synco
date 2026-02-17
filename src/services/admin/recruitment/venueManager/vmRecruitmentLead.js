const {
  RecruitmentLead,
  CandidateProfile,
  Venue,
  ClassSchedule,
  Admin,
  sequelize,
} = require("../../../../models");

const { getEmailConfig } = require("../../../../services/email");
const sendEmail = require("../../../../utils/email/sendEmail");
const emailModel = require("../../../../services/email");
const moment = require("moment");
const { Op } = require("sequelize");

exports.createRecruitmentVmLead = async (data) => {
  try {
    data.status = "pending";
    if (process.env.DEBUG === "true") {
      console.log("▶️ Data passed to model:", data);
    }

    const recruitmentVmLead = await RecruitmentLead.create(data);

    return {
      status: true,
      message: "Rcruitment Lead created Successfully",
      data: recruitmentVmLead.get({ plain: true }),
    };
  } catch (error) {
    console.error("❌ Error creating createRecruitmentVmLead:", error);
    return { status: false, message: error.message };
  }
};

// COMBINED SERVICE LEAD AND CANDIDATE PROFILE
exports.createLeadAndCandidate = async (leadData, candidateData) => {
  const transaction = await sequelize.transaction();

  try {
    // ----------------------------------
    // 1️⃣ CREATE RECRUITMENT LEAD
    // ----------------------------------
    leadData.status = "pending";

    if (process.env.DEBUG === "true") {
      console.log("▶️ Lead Data:", leadData);
    }

    const recruitmentLead = await RecruitmentLead.create(leadData, {
      transaction,
    });

    const lead = recruitmentLead.get({ plain: true });

    // ----------------------------------
    // 2️⃣ SEND EMAIL (NON-BLOCKING)
    // ----------------------------------
    (async () => {
      try {
        if (!lead.email) return;

        const {
          status: configStatus,
          emailConfig,
          htmlTemplate,
          subject,
        } = await emailModel.getEmailConfig("admin", "vm-lead");

        if (!configStatus || !htmlTemplate) return;

        const candidateName = `${lead.firstName || ""} ${
          lead.lastName || ""
        }`.trim();

        const htmlBody = htmlTemplate
          .replace(
            /{{candidateName}}/g,
            candidateName || "Venue-Manager Applicant"
          )
          .replace(/{{email}}/g, lead.email)
          .replace(/{{source}}/g, lead.source || "website")
          .replace(/{{applicationStatus}}/g, "pending")
          .replace(/{{year}}/g, new Date().getFullYear());

        await sendEmail(emailConfig, {
          recipient: [
            {
              name: candidateName || "Vm Applicant",
              email: lead.email,
            },
          ],
          subject: subject || "Vm Application Update",
          htmlBody,
        });

        console.log(`📧 Vm email sent to ${lead.email}`);
      } catch (err) {
        console.error("❌ Email send failed:", err.message);
      }
    })();

    // ----------------------------------
    // 3️⃣ CREATE CANDIDATE PROFILE (MANDATORY)
    // ----------------------------------
    candidateData.recruitmentLeadId = lead.id;
    candidateData.status = "pending";

    const candidateProfile = await CandidateProfile.create(candidateData, {
      transaction,
    });

    // ----------------------------------
    // 4️⃣ UPDATE LEAD STATUS
    // ----------------------------------
    await RecruitmentLead.update(
      { status: "pending" },
      { where: { id: lead.id }, transaction }
    );

    // ----------------------------------
    // 5️⃣ COMMIT TRANSACTION
    // ----------------------------------
    await transaction.commit();

    return {
      status: true,
      message: "Recruitment Lead and Candidate created successfully",
      data: {
        lead: {
          ...lead,
          status: "pending",
        },
        candidateProfile: candidateProfile.get({ plain: true }),
      },
    };
  } catch (error) {
    await transaction.rollback();

    console.error("❌ Error in createLeadAndCandidate:", error);

    return {
      status: false,
      message: error.message,
    };
  }
};

function calculateTelephoneCallScore(profile) {
  if (!profile) return 0;

  const scores = [
    profile.telePhoneCallDeliveryCommunicationSkill,
    profile.telePhoneCallDeliveryPassionCoaching,
    profile.telePhoneCallDeliveryExperience,
    profile.telePhoneCallDeliveryKnowledgeOfSSS,
  ];

  const validScores = scores.filter((s) => typeof s === "number");

  const maxScore = validScores.length * 5;
  const totalScore = validScores.reduce((a, b) => a + b, 0);

  return maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0;
}

// ✅ GET ALL - by admin
exports.getAllVmRecruitmentLead = async (adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin or super admin ID",
        data: [],
      };
    }

    const recruitmentLead = await RecruitmentLead.findAll({
      where: {
        // createdBy: Number(adminId),
        appliedFor: "venue manager", // ⭐ static filter added here
      },

      include: [{ model: CandidateProfile, as: "candidateProfile" }],
      order: [["createdAt", "DESC"]],
    });

    const formatted = [];

    for (const lead of recruitmentLead) {
      const leadJson = lead.toJSON();
      const profile = leadJson.candidateProfile;
      if (profile?.availableVenueWork) {
        try {
          const venueIds = Array.isArray(profile.availableVenueWork)
            ? profile.availableVenueWork
            : JSON.parse(profile.availableVenueWork);

          const venues = await Venue.findAll({
            where: {
              id: venueIds,
            },
          });

          profile.availableVenueWork = {
            ids: venueIds,
            venues: venues.map((v) => v.toJSON()),
          };
        } catch (err) {
          profile.availableVenueWork = {
            ids: [],
            venues: [],
          };
        }
      }

      if (profile?.bookPracticalAssessment) {
        try {
          profile.bookPracticalAssessment = JSON.parse(
            profile.bookPracticalAssessment
          );

          for (let item of profile.bookPracticalAssessment) {
            // Fetch venue & class
            const venue = await Venue.findByPk(item.venueId);
            const classInfo = await ClassSchedule.findByPk(item.classId);

            item.venue = venue ? venue.toJSON() : null;
            item.classDetails = classInfo ? classInfo.toJSON() : null;

            // 🔹 Fetch venue manager (from Admin table)
            if (item.assignToVenueManagerId) {
              const admin = await Admin.findByPk(item.assignToVenueManagerId, {
                attributes: ["id", "firstName", "lastName", "email"],
              });

              item.venueManager = admin ? admin.toJSON() : null;
            } else {
              item.venueManager = null;
            }
          }
        } catch (err) {
          profile.bookPracticalAssessment = [];
        }
      }
      // -------------------------------
      // ✅ Format qualification
      // -------------------------------
      if (leadJson.qualification) {
        try {
          leadJson.qualification = Array.isArray(leadJson.qualification)
            ? leadJson.qualification
            : JSON.parse(leadJson.qualification);
        } catch (err) {
          leadJson.qualification = [];
        }
      }

      formatted.push(leadJson);
    }
    const now = new Date();
    const currentYear = now.getFullYear();
    const lastYear = currentYear - 1;

    // Leads for current year (for counts in totals)
    const currentYearLeads = recruitmentLead.filter(
      (lead) => new Date(lead.createdAt).getFullYear() === currentYear
    );

    // Leads for last year (for percentage calculation)
    const lastYearLeads = recruitmentLead.filter(
      (lead) => new Date(lead.createdAt).getFullYear() === lastYear
    );

    const totalApplicationsCurrentYear = currentYearLeads.filter(
      (lead) => lead.candidateProfile !== null
    ).length;

    const totalNewApplicationsCurrentYear = currentYearLeads.filter(
      (lead) =>
        lead.candidateProfile !== null &&
        new Date(lead.createdAt).getMonth() === now.getMonth()
    ).length;

    const totalToAssessmentsCurrentYear = currentYearLeads.filter(
      (lead) =>
        lead.candidateProfile?.bookPracticalAssessment &&
        lead.candidateProfile.bookPracticalAssessment.length > 0
    ).length;

    const totalToRecruitmentCurrentYear = currentYearLeads.filter(
      (lead) => lead.status === "recruited" && lead.candidateProfile !== null
    ).length;

    // Percentages are calculated based on last year's totalApplications
    const totalApplicationsLastYear = lastYearLeads.filter(
      (lead) => lead.candidateProfile !== null
    ).length;

    const calcPercent = (count) =>
      totalApplicationsLastYear > 0
        ? ((count / totalApplicationsLastYear) * 100).toFixed(2) + "%"
        : "0%";

    return {
      status: true,
      message: "Candidate Profile Data Fetched Successfully",
      totals: [
        {
          name: "totalApplications",
          count: totalApplicationsCurrentYear,
          percent: calcPercent(totalApplicationsCurrentYear),
        },
        {
          name: "totalNewApplications",
          count: totalNewApplicationsCurrentYear,
          percent: calcPercent(totalNewApplicationsCurrentYear),
        },
        {
          name: "totalToAssessments",
          count: totalToAssessmentsCurrentYear,
          percent: calcPercent(totalToAssessmentsCurrentYear),
        },
        {
          name: "totalToRecruitment",
          count: totalToRecruitmentCurrentYear,
          percent: calcPercent(totalToRecruitmentCurrentYear),
        },
      ],
      data: formatted,
    };
  } catch (error) {
    return {
      status: false,
      message: "Fetch getAllVmRecruitmentLead failed. " + error.message,
    };
  }
};

// exports.getVmRecruitmentLeadById = async (id, adminId) => {
//   try {
//     if (!adminId || isNaN(Number(adminId))) {
//       return {
//         status: false,
//         message: "Invalid admin or super admin ID",
//         data: [],
//       };
//     }

//     const recruitmentLead = await RecruitmentLead.findOne({
//       where: { id, createdBy: Number(adminId) },
//       include: [
//         { model: CandidateProfile, as: "candidateProfile" }
//       ],
//     });

//     if (!recruitmentLead) {
//       return { status: false, message: "recruitmentLead not found or unauthorized." };
//     }

//     const leadJson = recruitmentLead.toJSON();
//     const profile = leadJson.candidateProfile;

//     if (profile?.bookPracticalAssessment) {
//       try {
//         profile.bookPracticalAssessment = JSON.parse(profile.bookPracticalAssessment);

//         for (let item of profile.bookPracticalAssessment) {

//           const venue = await Venue.findByPk(item.venueId);
//           const classInfo = await ClassSchedule.findByPk(item.classId);

//           item.venue = venue ? venue.toJSON() : null;
//           item.classDetails = classInfo ? classInfo.toJSON() : null;

//           // Venue Manager
//           if (item.assignToVenueManagerId) {
//             const admin = await Admin.findByPk(item.assignToVenueManagerId, {
//               attributes: ["id", "firstName", "lastName", "email"],
//             });
//             item.venueManager = admin ? admin.toJSON() : null;
//           } else {
//             item.venueManager = null;
//           }
//         }

//       } catch (err) {
//         profile.bookPracticalAssessment = [];
//       }
//     }

//     // 🔥 Add telephone call score percentage
//     leadJson.telephoneCallScorePercentage = calculateTelephoneCallScore(profile);

//     return { status: true, data: leadJson };

//   } catch (error) {
//     return {
//       status: false,
//       message: "Get recruitmentLead failed. " + error.message,
//     };
//   }
// };

exports.getVmRecruitmentLeadById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin or super admin ID",
        data: {},
      };
    }

    const recruitmentLead = await RecruitmentLead.findOne({
      where: { id, appliedFor: "venue manager" }, // remove createdBy filter
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "dob",
        "age",
        "phoneNumber",
        "postcode",
        "appliedFor",
        "managementExperience",
        "level",
        "dbs",
        "status",
        "createdBy",
      ],
      include: [
        {
          model: CandidateProfile,
          as: "candidateProfile",
        },
      ],
    });

    if (!recruitmentLead) {
      return {
        status: false,
        message: "recruitmentLead not found or unauthorized.",
        data: {},
      };
    }

    // Convert to JSON
    const leadJson = recruitmentLead.toJSON();
    const profile = leadJson.candidateProfile || {};

    // -------------------------------
    // ✅ Format qualification
    // -------------------------------
    if (leadJson.qualification) {
      try {
        leadJson.qualification = Array.isArray(leadJson.qualification)
          ? leadJson.qualification
          : JSON.parse(leadJson.qualification);
      } catch {
        leadJson.qualification = [];
      }
    }

    // -------------------------------
    // ✅ Resolve availableVenues
    // -------------------------------
    if (leadJson.availableVenues) {
      try {
        const venueIds = Array.isArray(leadJson.availableVenues)
          ? leadJson.availableVenues
          : JSON.parse(leadJson.availableVenues);

        const venues = await Venue.findAll({
          where: { id: venueIds },
        });

        leadJson.availableVenues = {
          ids: venueIds,
          venues: venues.map((v) => v.toJSON()),
        };
      } catch {
        leadJson.availableVenues = {
          ids: [],
          venues: [],
        };
      }
    }

    // Parse bookPracticalAssessment if exists
    if (profile.bookPracticalAssessment) {
      try {
        profile.bookPracticalAssessment = JSON.parse(
          profile.bookPracticalAssessment
        );

        for (let item of profile.bookPracticalAssessment) {
          const venue = await Venue.findByPk(item.venueId);
          const classInfo = await ClassSchedule.findByPk(item.classId);

          item.venue = venue ? venue.toJSON() : null;
          item.classDetails = classInfo ? classInfo.toJSON() : null;

          if (item.assignToVenueManagerId) {
            const admin = await Admin.findByPk(item.assignToVenueManagerId, {
              attributes: ["id", "firstName", "lastName", "email"],
            });
            item.venueManager = admin ? admin.toJSON() : null;
          } else {
            item.venueManager = null;
          }
        }
      } catch (err) {
        profile.bookPracticalAssessment = [];
      }
    }

    // Calculate telephone call score
    const telephoneCallScorePercentage = calculateTelephoneCallScore(profile);

    // Return all attributes individually at top level
    return {
      status: true,
      message: "Candidate Profile Data Fetched Successfully",
      data: {
        id: leadJson.id,
        firstName: leadJson.firstName,
        lastName: leadJson.lastName,
        email: leadJson.email,
        dob: leadJson.dob,
        age: leadJson.age,
        phoneNumber: leadJson.phoneNumber,
        postcode: leadJson.postcode,
        appliedFor: leadJson.appliedFor,
        managementExperience: leadJson.managementExperience,
        level: leadJson.level,
        dbs: leadJson.dbs,
        status: leadJson.status,
        createdBy: leadJson.createdBy,
        candidateProfile: profile,
        telephoneCallScorePercentage,
      },
    };
  } catch (error) {
    return {
      status: false,
      message: "Get recruitmentLead failed. " + error.message,
      data: {},
    };
  }
};

exports.rejectRecruitmentStatusById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin or super admin ID",
      };
    }

    // Find recruitment lead
    const recruitmentLead = await RecruitmentLead.findOne({
      where: { id, createdBy: Number(adminId) },
    });

    if (!recruitmentLead) {
      return {
        status: false,
        message: "Recruitment lead not found or unauthorized.",
      };
    }

    // Update status
    recruitmentLead.status = "rejected";
    await recruitmentLead.save();

    return {
      status: true,
      message: "Recruitment lead status updated to rejected.",
      data: recruitmentLead.toJSON(),
    };
  } catch (error) {
    console.error("❌ rejectRecruitmentStatusById Error:", error);
    return {
      status: false,
      message: "Failed to reject recruitment lead. " + error.message,
    };
  }
};

exports.sendEmail = async ({ recruitmentLeadId, admin }) => {
  try {
    // 1️⃣ Fetch recruitment lead
    const lead = await RecruitmentLead.findOne({
      where: { id: recruitmentLeadId },
      include: [{ model: CandidateProfile, as: "candidateProfile" }],
    });

    if (!lead) {
      return {
        status: false,
        message: "Recruitment lead not found.",
        sentTo: [],
      };
    }

    if (!lead.email) {
      return {
        status: false,
        message: "Candidate email not found.",
        sentTo: [],
      };
    }

    const candidateName = `${lead.firstName || ""} ${
      lead.lastName || ""
    }`.trim();
    const adminName = `${admin?.firstName || "Admin"} ${
      admin?.lastName || ""
    }`.trim();

    // 2️⃣ Load email template
    const {
      status: configStatus,
      emailConfig,
      htmlTemplate,
      subject,
    } = await emailModel.getEmailConfig("admin", "candidate-profile-reject");

    if (!configStatus || !htmlTemplate) {
      return {
        status: false,
        message: "Email template not configured.",
        sentTo: [],
      };
    }

    // 3️⃣ Prepare email body
    const htmlBody = htmlTemplate
      .replace(/{{candidateName}}/g, candidateName)
      .replace(/{{email}}/g, lead.email)
      .replace(/{{applicationStatus}}/g, lead.status)
      .replace(/{{adminName}}/g, adminName)
      .replace(/{{year}}/g, new Date().getFullYear().toString());

    // 4️⃣ Send email
    await sendEmail(emailConfig, {
      recipient: [{ name: candidateName, email: lead.email }],
      subject: subject || "Candidate Profile Update",
      htmlBody,
    });

    return {
      status: true,
      message: "Email sent successfully.",
      sentTo: [lead.email],
    };
  } catch (err) {
    console.error("❌ RecruitmentLeadService.sendEmail Error:", err);
    return {
      status: false,
      message: "Failed to send email.",
      error: err.message,
      sentTo: [],
    };
  }
};

exports.getAllVmRecruitmentLeadRport = async (adminId, dateRange) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin or super admin ID",
        data: [],
      };
    }

    // ================= DATE RANGE =================
    let startDate, endDate, prevStartDate, prevEndDate;

    if (!dateRange) {
      startDate = moment().startOf("year").toDate();
      endDate = moment().endOf("year").toDate();

      prevStartDate = moment(startDate).subtract(1, "year").toDate();
      prevEndDate = moment(endDate).subtract(1, "year").toDate();
    } else if (dateRange === "thisMonth") {
      startDate = moment().startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate)
        .subtract(1, "month")
        .startOf("month")
        .toDate();
      prevEndDate = moment(endDate)
        .subtract(1, "month")
        .endOf("month")
        .toDate();
    } else if (dateRange === "lastMonth") {
      startDate = moment().subtract(1, "month").startOf("month").toDate();
      endDate = moment().subtract(1, "month").endOf("month").toDate();

      prevStartDate = moment(startDate)
        .subtract(1, "month")
        .startOf("month")
        .toDate();
      prevEndDate = moment(startDate).subtract(1, "day").endOf("day").toDate();
    } else if (dateRange === "last3Months") {
      startDate = moment().subtract(3, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate)
        .subtract(3, "months")
        .startOf("month")
        .toDate();
      prevEndDate = moment(startDate).subtract(1, "day").endOf("day").toDate();
    } else if (dateRange === "last6Months") {
      startDate = moment().subtract(6, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate)
        .subtract(6, "months")
        .startOf("month")
        .toDate();
      prevEndDate = moment(startDate).subtract(1, "day").endOf("day").toDate();
    } else {
      throw new Error("Invalid dateRange");
    }

    const combinedStart = prevStartDate;
    const combinedEnd = endDate;

    const recruitmentLead = await RecruitmentLead.findAll({
      where: {
        createdBy: Number(adminId),
        createdAt: { [Op.between]: [combinedStart, combinedEnd] },
        appliedFor: "venue manager",
      },
      include: [
        { model: CandidateProfile, as: "candidateProfile" },
        {
          model: Admin,
          as: "creator",
          attributes: ["id", "firstName", "lastName", "profile"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // ================= CONSTANTS =================
    const now = new Date();
    const CURRENT_YEAR = now.getFullYear();

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const chartData = {
      leads: {
        currentYear: Object.fromEntries(monthNames.map((m) => [m, 0])),
        lastYear: Object.fromEntries(monthNames.map((m) => [m, 0])),
      },
      hires: {
        currentYear: Object.fromEntries(monthNames.map((m) => [m, 0])),
        lastYear: Object.fromEntries(monthNames.map((m) => [m, 0])),
      },
    };

    // ===== SAME KEYS AS BEFORE =====
    const yearlyCounters = {
      thisYear: {
        totalLeads: 0,
        telephoneCalls: 0,
        practicalAssessments: 0,
        hires: 0,
      },
      lastYear: {
        totalLeads: 0,
        telephoneCalls: 0,
        practicalAssessments: 0,
        hires: 0,
      },
    };

    // ===== LEGACY COUNTS (NOT REMOVED) =====
    const qualificationStats = {
      faQualification: 0,
      dbsCertificate: 0,
      coachingExperience: 0,
      noExperience: 0,
    };

    const ageCount = {};
    const genderCount = { Male: 0, Female: 0, Others: 0 };
    const venueCount = {};
    const venueDemandCount = {};
    const leadSourceCount = {};
    const topAgentCount = {};

    let totalCallScore = 0;
    let totalCallMax = 0;
    let totalPracticalLeadsWithAssessment = 0;

    const normalizePercent = (items) => {
      const total = items.reduce((s, i) => s + i.count, 0);
      return items.map((i) => ({
        ...i,
        percent: total > 0 ? ((i.count / total) * 100).toFixed(0) + "%" : "0%",
      }));
    };

    // ================= LOOP =================
    for (const lead of recruitmentLead) {
      const created = new Date(lead.createdAt);
      const year = created.getFullYear();
      const monthName = monthNames[created.getMonth()];
      const profile = lead.candidateProfile;

      let bucket = null;
      if (created >= startDate && created <= endDate)
        bucket = yearlyCounters.thisYear;
      else if (created >= prevStartDate && created <= prevEndDate)
        bucket = yearlyCounters.lastYear;
      else continue;

      // ===== LEGACY TOTAL LEADS LOGIC =====
      if (lead.status === "pending") bucket.totalLeads++;

      // ===== LEGACY TELEPHONE LOGIC =====
      if (profile && !profile.telephoneCallSetupEmail) {
        bucket.telephoneCalls++;
      }

      // ===== LEGACY PRACTICAL / HIRES LOGIC =====
      let booked = profile?.bookPracticalAssessment;
      if (typeof booked === "string") {
        try {
          booked = JSON.parse(booked);
        } catch {
          booked = [];
        }
      }

      if (lead.status === "recruited") {
        bucket.hires++;
        if (Array.isArray(booked)) {
          bucket.practicalAssessments += booked.length;
          if (booked.length) totalPracticalLeadsWithAssessment++;
        }
      }

      // ===== CHART DATA (FIXED ONLY) =====
      if (lead.status === "pending") {
        if (bucket === yearlyCounters.thisYear)
          chartData.leads.currentYear[monthName]++;
        else chartData.leads.lastYear[monthName]++;
      }

      if (lead.status === "recruited") {
        if (bucket === yearlyCounters.thisYear)
          chartData.hires.currentYear[monthName]++;
        else chartData.hires.lastYear[monthName]++;
      }

      // ===== DEMOGRAPHICS =====
      if (lead.age) ageCount[lead.age] = (ageCount[lead.age] || 0) + 1;

      let g = (lead.gender || "Others").toLowerCase();
      g = g === "male" ? "Male" : g === "female" ? "Female" : "Others";
      genderCount[g]++;

      if (lead.level === "yes") qualificationStats.faQualification++;
      if (lead.dbs === "yes") qualificationStats.dbsCertificate++;
      if (lead.managementExperience === "yes")
        qualificationStats.coachingExperience++;
      else qualificationStats.noExperience++;

      if (profile) {
        const skills = [
          profile.telePhoneCallDeliveryCommunicationSkill,
          profile.telePhoneCallDeliveryPassionCoaching,
          profile.telePhoneCallDeliveryExperience,
          profile.telePhoneCallDeliveryKnowledgeOfSSS,
        ].filter((s) => typeof s === "number");

        if (skills.length) {
          totalCallScore += skills.reduce((a, b) => a + b, 0);
          totalCallMax += skills.length * 5;
        }

        const source = profile.howDidYouHear?.trim() || "Other";
        leadSourceCount[source] = (leadSourceCount[source] || 0) + 1;
      }

      if (Array.isArray(booked)) {
        for (const b of booked) {
          if (b?.venueId) {
            venueCount[b.venueId] = (venueCount[b.venueId] || 0) + 1;
            venueDemandCount[b.venueId] =
              (venueDemandCount[b.venueId] || 0) + 1;
          }
        }
      }

      // ===== TOP AGENT (LEGACY – ALL YEARS) =====
      if (
        lead.status === "recruited" &&
        lead.creator &&
        created >= startDate &&
        created <= endDate
      ) {
        const agentId = lead.creator.id;
        if (!agentId) continue;

        if (!topAgentCount[agentId]) {
          topAgentCount[agentId] = {
            firstName: lead.creator.firstName || "",
            lastName: lead.creator.lastName || "",
            profile: lead.creator.profile || "",
            totalHires: 0,
          };
        }

        topAgentCount[agentId].totalHires++;
      }
    }

    const calcRate = (v, t) =>
      t > 0 ? ((v / t) * 100).toFixed(0) + "%" : "0%";
    const totalLeadsCount = recruitmentLead.length || 1;

    // ---- Normalize leadSource percent with rounding fix to sum 100%
    const totalCounted = Object.values(leadSourceCount).reduce(
      (sum, val) => sum + val,
      0
    );

    let runningPercents = 0;

    const byLeadSource = Object.keys(leadSourceCount).map(
      (source, index, arr) => {
        const count = leadSourceCount[source];

        if (index < arr.length - 1) {
          const percentNum = Math.round((count / totalCounted) * 100);
          runningPercents += percentNum;
          return {
            source,
            count,
            percent: percentNum + "%",
          };
        } else {
          const percentNum = 100 - runningPercents;
          return {
            source,
            count,
            percent: percentNum + "%",
          };
        }
      }
    );

    // ---- Other normalized percentages
    const byAge = normalizePercent(
      Object.keys(ageCount).map((age) => ({
        age: Number(age),
        count: ageCount[age],
      }))
    );

    const byGender = normalizePercent(
      Object.keys(genderCount).map((g) => ({
        gender: g,
        count: genderCount[g],
      }))
    );

    const venues = await Venue.findAll();

    const byVenue = normalizePercent(
      Object.keys(venueCount).map((id) => {
        const venue = venues.find((v) => v.id == id);
        return {
          venueName: venue ? venue.name : "Unknown",
          count: venueCount[id],
        };
      })
    );

    const averageCallGrade = totalCallMax
      ? Math.round((totalCallScore / totalCallMax) * 100)
      : 0;
    const averageCoachEducationPassMark = averageCallGrade;
    const averagePracticalGrade = recruitmentLead.length
      ? Math.round(
          (totalPracticalLeadsWithAssessment / recruitmentLead.length) * 100
        )
      : 0;

    const topAgents = Object.keys(topAgentCount)
      .map((id) => ({
        agentId: Number(id),
        firstName: topAgentCount[id].firstName,
        lastName: topAgentCount[id].lastName,
        profile: topAgentCount[id].profile,
        totalHires: topAgentCount[id].totalHires,
      }))
      .sort((a, b) => b.totalHires - a.totalHires);

    const report = {
      totalLeads: {
        current: yearlyCounters.thisYear.totalLeads,
        previous: yearlyCounters.lastYear.totalLeads,
        conversionRate: calcRate(
          yearlyCounters.thisYear.totalLeads,
          yearlyCounters.thisYear.totalLeads
        ),
      },
      videoCallInterviews: {
        current: yearlyCounters.thisYear.telephoneCalls,
        previous: yearlyCounters.lastYear.telephoneCalls,
        conversionRate: calcRate(
          yearlyCounters.thisYear.telephoneCalls,
          yearlyCounters.thisYear.totalLeads
        ),
      },
      practicalAssessments: {
        current: yearlyCounters.thisYear.practicalAssessments,
        previous: yearlyCounters.lastYear.practicalAssessments,
        conversionRate: calcRate(
          yearlyCounters.thisYear.practicalAssessments,
          yearlyCounters.thisYear.totalLeads
        ),
      },
      hires: {
        current: yearlyCounters.thisYear.hires,
        previous: yearlyCounters.lastYear.hires,
        conversionRate: calcRate(
          yearlyCounters.thisYear.hires,
          yearlyCounters.thisYear.totalLeads
        ),
      },
      conversionRate: {
        current: calcRate(
          yearlyCounters.thisYear.hires,
          yearlyCounters.thisYear.totalLeads
        ),
        previous: calcRate(
          yearlyCounters.lastYear.hires,
          yearlyCounters.lastYear.totalLeads
        ),
      },
    };

    return {
      status: true,
      message: "Recruitment report fetched successfully.",
      data: {
        report,
        chartData,
        coaches_demographics: {
          byAge,
          byGender,
          byVenue,
        },
        qualificationsAndExperince: {
          faQualification: qualificationStats.faQualification,
          dbsCertificate: qualificationStats.dbsCertificate,
          coachingExperience: qualificationStats.coachingExperience,
          noExperience: qualificationStats.noExperience,
        },
        onboardingResults: {
          averageCallGrade: averageCallGrade + "%",
          averagePracticalAssessmentGrade: averagePracticalGrade + "%",
          averageCoachEducationPassMark: averageCoachEducationPassMark + "%",
        },
        sourceOfLeads: byLeadSource,
        topAgentsMostHires: topAgents,
      },
    };
  } catch (error) {
    return {
      status: false,
      message: "Fetch recruitmentLead failed. " + error.message,
    };
  }
};
