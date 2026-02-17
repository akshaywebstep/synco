const {
  RecruitmentLead,
  CandidateProfile,
  Venue,
  ClassSchedule,
  Admin,
  sequelize,
} = require("../../../../models");

const { getEmailConfig } = require("../../../email");
const sendEmail = require("../../../../utils/email/sendEmail");
const emailModel = require("../../../email");
const moment = require("moment");
const { Op } = require("sequelize");

exports.createRecruitmentFranchiseLead = async (data) => {
  try {
    data.status = "pending";

    if (process.env.DEBUG === "true") {
      console.log("▶️ Data passed to model:", data);
    }

    // ----------------------------------
    // 💾 CREATE LEAD
    // ----------------------------------
    const recruitmentLead = await RecruitmentLead.create(data);
    const lead = recruitmentLead.get({ plain: true });

    // ----------------------------------
    // 📧 SEND EMAIL (ALWAYS)
    // ----------------------------------
    try {
      if (!lead.email) {
        console.warn("⚠️ Email not found, skipping email send");
      } else {
        // 1️⃣ Load email template
        const {
          status: configStatus,
          emailConfig,
          htmlTemplate,
          subject,
        } = await emailModel.getEmailConfig("admin", "franchise-lead");

        if (!configStatus || !htmlTemplate) {
          console.warn(
            "⚠️ Email template not configured for franchise creation"
          );
        } else {
          // Build candidate full name
          const candidateName = `${lead.firstName || ""} ${
            lead.lastName || ""
          }`.trim();

          // Ensure applicationStatus fallback
          const applicationStatus = lead.status || "Pending";

          // 2️⃣ Build email body
          const htmlBody = htmlTemplate
            .replace(
              /{{candidateName}}/g,
              candidateName || "Franchise Applicant"
            )
            .replace(/{{email}}/g, lead.email)
            .replace(/{{source}}/g, lead.source || "website")
            .replace(/{{applicationStatus}}/g, applicationStatus)
            .replace(/{{year}}/g, new Date().getFullYear().toString());

          // 3️⃣ Send email
          await sendEmail(emailConfig, {
            recipient: [
              {
                name: candidateName || "Franchise Applicant",
                email: lead.email,
              },
            ],
            subject: subject || "Franchise Application Received",
            htmlBody,
          });

          console.log(`📧 Franchise creation email sent to ${lead.email}`);
        }
      }
    } catch (emailErr) {
      // ❗ DO NOT FAIL CREATION IF EMAIL FAILS
      console.error(
        "❌ Error sending franchise creation email:",
        emailErr.message
      );
    }

    // ----------------------------------
    // ✅ RETURN SUCCESS
    // ----------------------------------
    return {
      status: true,
      message: "Recruitment Lead Created Successfully",
      data: lead,
    };
  } catch (error) {
    console.error("❌ Error creating createRecruitmentFranchiseLead:", error);

    return {
      status: false,
      message: error.message,
    };
  }
};

// exports.createRecruitmentFranchiseLead = async (data) => {
//   try {
//     data.status = "pending";
//     if (process.env.DEBUG === "true") {
//       console.log("▶️ Data passed to model:", data);
//     }

//     const recruitmentLead = await RecruitmentLead.create(data);

//     return {
//       status: true,
//       message: "Recruitment Lead Created Succesfully",
//       data: recruitmentLead.get({ plain: true }),
//     };
//   } catch (error) {
//     console.error("❌ Error creating createRecruitmentFranchiseLead:", error);
//     return { status: false, message: error.message };
//   }
// };

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
exports.getAllFranchiseRecruitmentLead = async (adminId) => {
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
        appliedFor: "franchise",
        [Op.or]: [
          { createdBy: Number(adminId) },
          { createdBy: null }, // ✅ website leads
        ],
      },

      include: [{ model: CandidateProfile, as: "candidateProfile" }],
      order: [["createdAt", "DESC"]],
    });

    const formatted = [];

    for (const lead of recruitmentLead) {
      const leadJson = lead.toJSON();
      const profile = leadJson.candidateProfile;

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

      formatted.push(leadJson);
    }
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // ✅ current year leads only (BASE)
    const currentYearLeads = recruitmentLead.filter(
      (lead) => new Date(lead.createdAt).getFullYear() === currentYear
    );

    // total franchise leads (current year)
    const totalFranchiseLeads = currentYearLeads.length;

    // new franchise leads (current month + year)
    const totalNewFranchiseLeads = currentYearLeads.filter(
      (lead) => new Date(lead.createdAt).getMonth() === currentMonth
    ).length;

    // to assessments (same logic as report)
    const totalToAssessments = currentYearLeads.filter((lead) => {
      let booked = lead.candidateProfile?.bookPracticalAssessment;

      if (typeof booked === "string") {
        try {
          booked = JSON.parse(booked);
        } catch {
          booked = [];
        }
      }

      return Array.isArray(booked) && booked.length > 0;
    }).length;

    // leads to sales (recruited, current year)
    const totalLeadsToSales = currentYearLeads.filter(
      (lead) => lead.status === "recruited"
    ).length;

    return {
      status: true,
      message:
        "Recruitment Lead And Candidate Profile Data Fetched Succesfully",
      totals: [
        {
          name: "totalFranchiseLeads",
          count: totalFranchiseLeads,
          percent: totalFranchiseLeads > 0 ? "100%" : "0%",
        },
        {
          name: "totalNewFranchiseLeads",
          count: totalNewFranchiseLeads,
          percent:
            totalFranchiseLeads > 0
              ? ((totalNewFranchiseLeads / totalFranchiseLeads) * 100).toFixed(
                  2
                ) + "%"
              : "0%",
        },
        {
          name: "totalToAssessments",
          count: totalToAssessments,
          percent:
            totalFranchiseLeads > 0
              ? ((totalToAssessments / totalFranchiseLeads) * 100).toFixed(2) +
                "%"
              : "0%",
        },
        {
          name: "totalLeadsToSales",
          count: totalLeadsToSales,
          percent:
            totalFranchiseLeads > 0
              ? ((totalLeadsToSales / totalFranchiseLeads) * 100).toFixed(2) +
                "%"
              : "0%",
        },
      ],
      data: formatted,
    };
  } catch (error) {
    return {
      status: false,
      message: "Fetch getAllFranchiseRecruitmentLead failed. " + error.message,
    };
  }
};

exports.assignLeadToAgent = async ({ leadIds, createdBy }) => {
  const t = await sequelize.transaction();

  try {
    // ✅ Validation
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      throw new Error("At least one lead ID is required");
    }

    if (!createdBy || isNaN(Number(createdBy))) {
      throw new Error("Valid agent ID is required");
    }

    // ✅ Check agent exists
    const agent = await Admin.findByPk(createdBy, { transaction: t });
    if (!agent) {
      throw new Error("Agent not found");
    }

    // ✅ Fetch leads (parentName already exists here)
    const leads = await RecruitmentLead.findAll({
      where: {
        id: { [Op.in]: leadIds },
      },
      attributes: ["id", "firstName", "lastName", "createdBy"],
      transaction: t,
    });

    if (leads.length !== leadIds.length) {
      throw new Error("One or more leads were not found");
    }

    // ✅ Check already assigned leads
    const alreadyAssigned = leads.filter((lead) => lead.createdBy !== null);

    if (alreadyAssigned.length > 0) {
      const names = alreadyAssigned
        .map((lead) => lead.firstName + " " + lead.lastName || "Unknown Parent")
        .join(", ");

      throw new Error(`${names} lead already assigned`);
    }

    // ✅ Assign agent
    await RecruitmentLead.update(
      {
        createdBy,
        updatedAt: new Date(),
      },
      {
        where: {
          id: { [Op.in]: leadIds },
        },
        transaction: t,
      }
    );

    await t.commit();

    return {
      status: true,
      message: "Leads successfully assigned to agent",
      data: {
        leadIds,
        createdBy,
        totalAssigned: leadIds.length,
      },
    };
  } catch (error) {
    await t.rollback();
    return {
      status: false,
      message: error.message,
    };
  }
};
// GET BY ID
exports.getFranchiseRecruitmentLeadById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin or super admin ID",
        data: {},
      };
    }

    // ✅ Fetch lead without restricting by createdBy
    const recruitmentLead = await RecruitmentLead.findOne({
      where: { id, appliedFor: "franchise" }, // match franchise leads
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "dob",
        "gender",
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

    // Parse bookPracticalAssessment if exists
    if (profile.bookPracticalAssessment) {
      try {
        profile.bookPracticalAssessment = JSON.parse(
          profile.bookPracticalAssessment
        );

        // Fetch related venue, class, and admin details concurrently
        profile.bookPracticalAssessment = await Promise.all(
          profile.bookPracticalAssessment.map(async (item) => {
            const [venue, classInfo, admin] = await Promise.all([
              Venue.findByPk(item.venueId),
              ClassSchedule.findByPk(item.classId),
              item.assignToVenueManagerId
                ? Admin.findByPk(item.assignToVenueManagerId, {
                    attributes: ["id", "firstName", "lastName", "email"],
                  })
                : null,
            ]);

            item.venue = venue ? venue.toJSON() : null;
            item.classDetails = classInfo ? classInfo.toJSON() : null;
            item.venueManager = admin ? admin.toJSON() : null;

            return item;
          })
        );
      } catch (err) {
        profile.bookPracticalAssessment = [];
      }
    }

    // Calculate telephone call score
    const telephoneCallScorePercentage = calculateTelephoneCallScore(profile);

    // Return all attributes individually at top level (same as getAll)
    return {
      status: true,
      message:
        "Recruitment Lead And Candidate Profile Data Fetched Succesfully",
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
        gender: leadJson.gender,
        createdBy: leadJson.createdBy,
        candidateProfile: profile,
        telephoneCallScorePercentage,
      },
    };
  } catch (error) {
    return {
      status: false,
      message: "Get getFranchiseRecruitmentLeadById failed. " + error.message,
      data: {},
    };
  }
};

exports.rejectFranchiseRecruitmentStatusById = async (id, adminId) => {
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
    console.error("❌ rejectFranchiseRecruitmentStatusById Error:", error);
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

exports.sendOfferEmail = async ({ recruitmentLeadId, admin }) => {
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
    } = await emailModel.getEmailConfig("admin", "candidate-profile-offer");

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

exports.getAllFranchiseRecruitmentLeadRport = async (adminId, dateRange) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID", data: [] };
    }

    // ================= DATE RANGE =================
    let startDate, endDate, prevStartDate, prevEndDate;
    if (!dateRange) {
      startDate = moment().startOf("year").toDate();
      endDate = moment().endOf("year").toDate();
      prevStartDate = moment(startDate)
        .subtract(1, "year")
        .startOf("day")
        .toDate();
      prevEndDate = moment(endDate).subtract(1, "year").endOf("day").toDate();
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
      prevEndDate = moment(endDate)
        .subtract(1, "month")
        .endOf("month")
        .toDate();
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

    // ================= FETCH LEADS =================
    const recruitmentLead = await RecruitmentLead.findAll({
      where: {
        createdBy: Number(adminId),
        appliedFor: "franchise",
        createdAt: { [Op.between]: [combinedStart, combinedEnd] },
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
    const LAST_YEAR = CURRENT_YEAR - 1;
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

    const yearlyCounters = {
      thisYear: {
        totalLeads: 0,
        discoveryCalls: 0,
        practicalAssessments: 0,
        hires: 0,
      },
      lastYear: {
        totalLeads: 0,
        discoveryCalls: 0,
        practicalAssessments: 0,
        hires: 0,
      },
    };

    const yearlyDiscoverySet = { thisYear: new Set(), lastYear: new Set() };
    const yearlyHiredSet = { thisYear: new Set(), lastYear: new Set() };

    const ageCount = {};
    const genderCount = { Male: 0, Female: 0, Others: 0 };
    const venueCount = {};
    const venueDemandCount = {};
    const leadSourceCount = {};
    const topAgentCount = {};
    const qualificationStats = {
      faQualification: 0,
      dbsCertificate: 0,
      coachingExperience: 0,
      noExperience: 0,
    };

    let totalCallScore = 0,
      totalCallMax = 0,
      totalPracticalLeadsWithAssessment = 0;

    // ================= LOOP =================
    for (const lead of recruitmentLead) {
      const created = new Date(lead.createdAt);
      const monthName = monthNames[created.getMonth()];
      const profile = lead.candidateProfile;

      // ===== DETERMINE BUCKET =====
      let bucket = null;
      if (created >= startDate && created <= endDate)
        bucket = yearlyCounters.thisYear;
      else if (created >= prevStartDate && created <= prevEndDate)
        bucket = yearlyCounters.lastYear;
      else continue;

      // ===== TOTAL LEADS =====
      bucket.totalLeads++;

      // ===== DISCOVERY CALLS =====
      let discovery = profile?.discoveryDay;
      if (typeof discovery === "string") {
        try {
          discovery = JSON.parse(discovery);
        } catch {
          discovery = [];
        }
      }
      if (
        lead.status !== "rejected" &&
        Array.isArray(discovery) &&
        discovery.length > 0
      ) {
        bucket.discoveryCalls++;
        if (bucket === yearlyCounters.thisYear)
          yearlyDiscoverySet.thisYear.add(lead.id);
        else yearlyDiscoverySet.lastYear.add(lead.id);
      }

      // ===== PRACTICAL ASSESSMENTS =====
      let practicalBooked = profile?.bookPracticalAssessment;
      if (typeof practicalBooked === "string") {
        try {
          practicalBooked = JSON.parse(practicalBooked);
        } catch {
          practicalBooked = [];
        }
      }
      if (Array.isArray(practicalBooked) && practicalBooked.length > 0) {
        bucket.practicalAssessments++;
        totalPracticalLeadsWithAssessment++;
        for (const b of practicalBooked) {
          if (b?.venueId) {
            venueCount[b.venueId] = (venueCount[b.venueId] || 0) + 1;
            venueDemandCount[b.venueId] =
              (venueDemandCount[b.venueId] || 0) + 1;
          }
        }
      }

      // ===== HIRES =====
      if (lead.status === "recruited") {
        bucket.hires++;
        if (bucket === yearlyCounters.thisYear)
          yearlyHiredSet.thisYear.add(lead.id);
        else yearlyHiredSet.lastYear.add(lead.id);

        // ===== TOP AGENTS =====
        if (lead.creator?.id) {
          const id = lead.creator.id;
          if (!topAgentCount[id])
            topAgentCount[id] = {
              firstName: lead.creator.firstName || "",
              lastName: lead.creator.lastName || "",
              profile: lead.creator.profile || "",
              totalHires: 0,
            };
          topAgentCount[id].totalHires++;
        }
      }

      // ===== CHART DATA =====
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

      // ===== AGE / GENDER =====
      if (lead.age) ageCount[lead.age] = (ageCount[lead.age] || 0) + 1;
      let g = (lead.gender || "Others").toLowerCase();
      g = g === "male" ? "Male" : g === "female" ? "Female" : "Others";
      genderCount[g]++;

      // ===== QUALIFICATIONS =====
      if (lead.level === "yes") qualificationStats.faQualification++;
      if (lead.dbs === "yes") qualificationStats.dbsCertificate++;
      if (lead.managementExperience === "yes")
        qualificationStats.coachingExperience++;
      if (lead.managementExperience === "no") qualificationStats.noExperience++;

      // ===== CALL SCORES =====
      if (profile) {
        const skills = [
          profile.telePhoneCallDeliveryCommunicationSkill,
          profile.telePhoneCallDeliveryPassionCoaching,
          profile.telePhoneCallDeliveryExperience,
          profile.telePhoneCallDeliveryKnowledgeOfSSS,
        ].filter((v) => typeof v === "number");
        if (skills.length) {
          totalCallScore += skills.reduce((a, b) => a + b, 0);
          totalCallMax += skills.length * 5;
        }
      }

      // ===== SOURCE OF LEADS =====
      const source = profile?.howDidYouHear?.trim() || "Other";
      leadSourceCount[source] = (leadSourceCount[source] || 0) + 1;
    }

    // ================= NORMALIZE =================
    const normalizePercent = (items) => {
      const total = items.reduce((s, i) => s + i.count, 0);
      return items.map((i) => ({
        ...i,
        percent: total > 0 ? Math.round((i.count / total) * 100) + "%" : "0%",
      }));
    };

    const byAge = normalizePercent(
      Object.keys(ageCount).map((a) => ({ age: +a, count: ageCount[a] }))
    );
    const byGender = normalizePercent(
      Object.keys(genderCount).map((g) => ({
        gender: g,
        count: genderCount[g],
      }))
    );
    const byLeadSource = normalizePercent(
      Object.keys(leadSourceCount).map((s) => ({
        source: s,
        count: leadSourceCount[s],
      }))
    );
    const topAgents = Object.values(topAgentCount).sort(
      (a, b) => b.totalHires - a.totalHires
    );

    const totalCallGrade = totalCallMax
      ? Math.round((totalCallScore / totalCallMax) * 100) + "%"
      : "0%";
    const totalPracticalGrade = totalPracticalLeadsWithAssessment
      ? Math.round(
          (totalPracticalLeadsWithAssessment /
            yearlyCounters.thisYear.totalLeads) *
            100
        ) + "%"
      : "0%";

    const calcRate = (v, t) =>
      t > 0 ? ((v / t) * 100).toFixed(0) + "%" : "0%";

    const report = {
      totalLeads: {
        current: yearlyCounters.thisYear.totalLeads,
        previous: yearlyCounters.lastYear.totalLeads,
        conversionRate: calcRate(
          yearlyCounters.thisYear.totalLeads,
          yearlyCounters.lastYear.totalLeads
        ),
      },
      discoveryCalls: {
        current: yearlyCounters.thisYear.discoveryCalls,
        previous: yearlyCounters.lastYear.discoveryCalls,
        conversionRate: calcRate(
          yearlyDiscoverySet.thisYear.size,
          yearlyCounters.thisYear.totalLeads
        ),
      },
      practicalAssessments: {
        current: yearlyCounters.thisYear.practicalAssessments,
        previous: yearlyCounters.lastYear.practicalAssessments,
        conversionRate: calcRate(
          yearlyCounters.thisYear.practicalAssessments,
          yearlyDiscoverySet.thisYear.size
        ),
      },
      hires: {
        current: yearlyCounters.thisYear.hires,
        previous: yearlyCounters.lastYear.hires,
        conversionRate: calcRate(
          yearlyHiredSet.thisYear.size,
          yearlyDiscoverySet.thisYear.size
        ),
      },
      conversionRate: {
        current: calcRate(
          yearlyHiredSet.thisYear.size,
          yearlyCounters.thisYear.totalLeads
        ),
        previous: calcRate(
          yearlyHiredSet.lastYear.size,
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
        franchise_demographics: { byAge, byGender },
        qualificationsAndExperience: qualificationStats,
        onboardingResults: {
          averageCallGrade: totalCallGrade,
          averagePracticalAssessmentGrade: totalPracticalGrade,
        },
        sourceOfLeads: byLeadSource,
        topAgentsMostHires: topAgents,
      },
    };
  } catch (error) {
    return { status: false, message: error.message };
  }
};
