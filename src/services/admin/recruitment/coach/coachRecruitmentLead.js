const { RecruitmentLead, CandidateProfile, Venue, ClassSchedule, Admin } = require("../../../../models");
const { Op } = require("sequelize");
const { getEmailConfig } = require("../../../../services/email");
const sendEmail = require("../../../../utils/email/sendEmail");
const emailModel = require("../../../../services/email");
exports.createRecruitmentLead = async (data) => {
  try {
    data.status = "pending";
    if (process.env.DEBUG === "true") {
      console.log("▶️ Data passed to model:", data);
    }

    const recruitmentLead = await RecruitmentLead.create(data);

    return {
      status: true,
      message: "Recuitment Lead Created Succesfully",
      data: recruitmentLead.get({ plain: true })
    };
  } catch (error) {
    console.error("❌ Error creating recruitmentLead:", error);
    return { status: false, message: error.message };
  }
};

function calculateTelephoneCallScore(profile) {
  if (!profile) return 0;

  const scores = [
    profile.telePhoneCallDeliveryCommunicationSkill,
    profile.telePhoneCallDeliveryPassionCoaching,
    profile.telePhoneCallDeliveryExperience,
    profile.telePhoneCallDeliveryKnowledgeOfSSS
  ];

  const validScores = scores.filter(s => typeof s === "number");

  const maxScore = validScores.length * 5;
  const totalScore = validScores.reduce((a, b) => a + b, 0);

  return maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0;
}

// ✅ GET ALL - by admin
exports.getAllRecruitmentLead = async (adminId) => {
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
        createdBy: Number(adminId),
        appliedFor: "coach"  // ⭐ static filter added here
      },

      include: [
        { model: CandidateProfile, as: "candidateProfile" }
      ],
      order: [["createdAt", "DESC"]],
    });

    const formatted = [];

    for (const lead of recruitmentLead) {
      const leadJson = lead.toJSON();
      const profile = leadJson.candidateProfile;

      if (profile?.bookPracticalAssessment) {
        try {
          profile.bookPracticalAssessment = JSON.parse(profile.bookPracticalAssessment);

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
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Total applications with candidateProfile
    const totalApplications = recruitmentLead.filter(
      (lead) => lead.candidateProfile !== null
    ).length;

    // New applications this month
    const totalNewApplications = recruitmentLead.filter(
      (lead) =>
        lead.candidateProfile !== null &&
        new Date(lead.createdAt).getMonth() === currentMonth &&
        new Date(lead.createdAt).getFullYear() === currentYear
    ).length;

    // Applications to assessments (have bookPracticalAssessment with entries)
    const totalToAssessments = recruitmentLead.filter(
      (lead) =>
        lead.candidateProfile?.bookPracticalAssessment &&
        lead.candidateProfile.bookPracticalAssessment.length > 0
    ).length;

    // Applications to recruitment (status = recruited)
    const totalToRecruitment = recruitmentLead.filter(
      (lead) =>
        lead.status === "recruited" &&
        lead.candidateProfile !== null
    ).length;

    // Optional: % of recruited applications
    const recruitmentPercent = totalApplications > 0
      ? ((totalToRecruitment / totalApplications) * 100).toFixed(2)
      : 0;

    // % of new applications this month
    const newApplicationsPercent = totalApplications > 0
      ? ((totalNewApplications / totalApplications) * 100).toFixed(2) + "%"
      : "0%";

    // % of applications to assessments
    const toAssessmentsPercent = totalApplications > 0
      ? ((totalToAssessments / totalApplications) * 100).toFixed(2) + "%"
      : "0%";

    const totalApplicationsPercent = totalApplications > 0 ? "100%" : "0%";
    return {
      status: true,
      message: "Recuitment Lead and  Succesfully",
      totals: [
        {
          name: "totalApplications",
          count: totalApplications,
          percent: totalApplications > 0 ? "100%" : "0%"
        },
        {
          name: "totalNewApplications",
          count: totalNewApplications,
          percent: totalApplications > 0 ? ((totalNewApplications / totalApplications) * 100).toFixed(2) + "%" : "0%"
        },
        {
          name: "totalToAssessments",
          count: totalToAssessments,
          percent: totalApplications > 0 ? ((totalToAssessments / totalApplications) * 100).toFixed(2) + "%" : "0%"
        },
        {
          name: "totalToRecruitment",
          count: totalToRecruitment,
          percent: totalApplications > 0 ? ((totalToRecruitment / totalApplications) * 100).toFixed(2) + "%" : "0%"
        }
      ],
      data: formatted
    };

  } catch (error) {
    return {
      status: false,
      message: "Fetch recruitmentLead failed. " + error.message,
    };
  }
};

exports.getRecruitmentLeadById = async (id, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin or super admin ID",
        data: [],
      };
    }

    const recruitmentLead = await RecruitmentLead.findOne({
      where: { id, createdBy: Number(adminId) },
      include: [
        { model: CandidateProfile, as: "candidateProfile" }
      ],
    });

    if (!recruitmentLead) {
      return { status: false, message: "recruitmentLead not found or unauthorized." };
    }

    const leadJson = recruitmentLead.toJSON();
    const profile = leadJson.candidateProfile;

    if (profile?.bookPracticalAssessment) {
      try {
        profile.bookPracticalAssessment = JSON.parse(profile.bookPracticalAssessment);

        for (let item of profile.bookPracticalAssessment) {

          const venue = await Venue.findByPk(item.venueId);
          const classInfo = await ClassSchedule.findByPk(item.classId);

          item.venue = venue ? venue.toJSON() : null;
          item.classDetails = classInfo ? classInfo.toJSON() : null;

          // Venue Manager
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

    // 🔥 Add telephone call score percentage
    leadJson.telephoneCallScorePercentage = calculateTelephoneCallScore(profile);

    return { status: true, data: leadJson };

  } catch (error) {
    return {
      status: false,
      message: "Get recruitmentLead failed. " + error.message,
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

    // ------------------------------------------
    // 🔍 NEW CHECK: Candidate profile must exist
    // ------------------------------------------
    const candidateProfile = await CandidateProfile.findOne({
      where: { recruitmentLeadId: recruitmentLead.id },
    });

    if (!candidateProfile) {
      return {
        status: false,
        message: "Cannot reject. Candidate profile does not exist.",
      };
    }

    // Update status to rejected
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
      return { status: false, message: "Recruitment lead not found.", sentTo: [] };
    }

    if (!lead.email) {
      return { status: false, message: "Candidate email not found.", sentTo: [] };
    }

    const candidateName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
    const adminName = `${admin?.firstName || "Admin"} ${admin?.lastName || ""}`.trim();

    // 2️⃣ Load email template
    const { status: configStatus, emailConfig, htmlTemplate, subject } =
      await emailModel.getEmailConfig("admin", "candidate-profile-reject");

    if (!configStatus || !htmlTemplate) {
      return { status: false, message: "Email template not configured.", sentTo: [] };
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

    return { status: true, message: "Email sent successfully.", sentTo: [lead.email] };
  } catch (err) {
    console.error("❌ RecruitmentLeadService.sendEmail Error:", err);
    return { status: false, message: "Failed to send email.", error: err.message, sentTo: [] };
  }
};

exports.getAllRecruitmentLeadRport = async (adminId) => {
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
        createdBy: Number(adminId),
        appliedFor: "coach"
      },
      include: [
        { model: CandidateProfile, as: "candidateProfile" }
      ],
      order: [["createdAt", "DESC"]],
    });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const chartData = {
      leads: {
        currentYear: Object.fromEntries(monthNames.map(m => [m, 0])),
        lastYear: Object.fromEntries(monthNames.map(m => [m, 0]))
      },
      hires: {
        currentYear: Object.fromEntries(monthNames.map(m => [m, 0])),
        lastYear: Object.fromEntries(monthNames.map(m => [m, 0]))
      }
    };

    const counters = {
      thisMonth: { totalLeads: 0, telephoneCalls: 0, practicalAssessments: 0, hires: 0 },
      lastMonth: { totalLeads: 0, telephoneCalls: 0, practicalAssessments: 0, hires: 0 }
    };
    const qualificationStats = {
      faQualification: 0,
      dbsCertificate: 0,
      coachingExperience: 0,
      noExperience: 0
    };

    // ========= DEMOGRAPHICS ===========
    const ageCount = {};
    const genderCount = { Male: 0, Female: 0, Others: 0 };
    // Normalize gender
    let g = (recruitmentLead.gender || "Others").toString().trim().toLowerCase();

    if (g === "male" || g === "m") g = "Male";
    else if (g === "female" || g === "f") g = "Female";
    else g = "Others";

    genderCount[g] = (genderCount[g] || 0) + 1;

    const venueCount = {};
    let totalCallScore = 0;
    let totalCallMax = 0;
    let totalPracticalScore = 0;
    let totalPracticalMax = 0;
    let totalPracticalLeadsWithAssessment = 0;
    const leadSourceCount = {};
    const venueDemandCount = {};
    const topAgentCount = {};

    for (const lead of recruitmentLead) {
      const created = new Date(lead.createdAt);
      const leadMonth = created.getMonth();
      const leadYear = created.getFullYear();
      const monthName = monthNames[leadMonth];
      const profile = lead.candidateProfile;

      // ========== THIS MONTH & LAST MONTH =============
      const bucket =
        leadMonth === currentMonth && leadYear === currentYear
          ? counters.thisMonth
          : leadMonth === lastMonth && leadYear === lastMonthYear
            ? counters.lastMonth
            : null;

      if (bucket) {
        if (lead.status === "pending") bucket.totalLeads++;

        if (profile?.telephoneCallSetupDate && profile?.telephoneCallSetupTime)
          bucket.telephoneCalls++;

        let booked = profile?.bookPracticalAssessment;
        if (typeof booked === "string") {
          try { booked = JSON.parse(booked); } catch { booked = []; }
        }
        if (lead.status === "recruited" && Array.isArray(booked))
          bucket.practicalAssessments += booked.length;

        if (lead.status === "recruited") bucket.hires++;
      }

      // ========== MONTHLY CHART DATA ==========
      if (lead.status === "pending") {
        if (leadYear === currentYear) chartData.leads.currentYear[monthName]++;
        if (leadYear === currentYear - 1) chartData.leads.lastYear[monthName]++;
      }

      if (lead.status === "recruited") {
        if (leadYear === currentYear) chartData.hires.currentYear[monthName]++;
        if (leadYear === currentYear - 1) chartData.hires.lastYear[monthName]++;
      }

      // ========== DEMOGRAPHICS ==========
      // AGE
      if (lead.age) {
        ageCount[lead.age] = (ageCount[lead.age] || 0) + 1;
      }

      // GENDER
      const g = lead.gender || "Others";
      genderCount[g] = (genderCount[g] || 0) + 1;

      // VENUE
      let booked = profile?.bookPracticalAssessment;
      if (typeof booked === "string") {
        try { booked = JSON.parse(booked); } catch { booked = []; }
      }

      if (Array.isArray(booked)) {
        for (const b of booked) {
          const venueId = b?.venueId;
          if (venueId) venueCount[venueId] = (venueCount[venueId] || 0) + 1;
        }
      }

      // === QUALIFICATIONS & EXPERIENCE ===
      if (lead.level === "yes") {
        qualificationStats.faQualification++;
      }

      if (lead.dbs === "yes") {
        qualificationStats.dbsCertificate++;
      }

      if (lead.managementExperience === "yes") {
        qualificationStats.coachingExperience++;
      } else if (lead.managementExperience === "no") {
        qualificationStats.noExperience++;
      }
      // const totalLeads = recruitmentLead.length;

      // === ONBOARDING RESULTS
      if (profile) {
        const skills = [
          profile.telePhoneCallDeliveryCommunicationSkill,
          profile.telePhoneCallDeliveryPassionCoaching,
          profile.telePhoneCallDeliveryExperience,
          profile.telePhoneCallDeliveryKnowledgeOfSSS
        ];

        const validSkills = skills.filter(s => typeof s === "number");
        if (validSkills.length > 0) {
          totalCallScore += validSkills.reduce((a, b) => a + b, 0);
          totalCallMax += validSkills.length * 5; // max score per skill = 5
        }
      }
      if (typeof booked === "string") {
        try { booked = JSON.parse(booked); } catch { booked = []; }
      }
      if (Array.isArray(booked) && booked.length > 0) {
        totalPracticalLeadsWithAssessment++; // increment counter
      }

      // === SOURCE COUNT 
      if (lead.candidateProfile) { // candidateProfile exists
        const source = lead.candidateProfile.howDidYouHear?.trim();
        if (source) {
          leadSourceCount[source] = (leadSourceCount[source] || 0) + 1;
        } else {
          leadSourceCount["Other"] = (leadSourceCount["Other"] || 0) + 1;
        }
      }

      // == HIGH DEMAND VENUE
      if (lead.candidateProfile) {
        let booked = lead.candidateProfile.bookPracticalAssessment;

        // Parse if string
        if (typeof booked === "string") {
          try { booked = JSON.parse(booked); } catch { booked = []; }
        }

        if (Array.isArray(booked)) {
          for (const b of booked) {
            const venueId = b?.venueId;
            if (venueId) {
              venueDemandCount[venueId] = (venueDemandCount[venueId] || 0) + 1;
            }
          }
        }
      }

      if (lead.status === "recruited") {
        const agentId = lead.createdBy;
        if (!topAgentCount[agentId]) {
          topAgentCount[agentId] = {
            totalHires: 0,
            firstName: lead.firstName || "",
            lastName: lead.lastName || ""
          };
        }
        topAgentCount[agentId].totalHires++;
      }

    }
    const totalLeads = recruitmentLead.length;
    const averageCallGrade = totalCallMax > 0 ? Math.round((totalCallScore / totalCallMax) * 100) : 0;
    const averagePracticalGrade = totalLeads > 0
      ? Math.round((totalPracticalLeadsWithAssessment / totalLeads) * 100)
      : 0;

    const byLeadSource = Object.keys(leadSourceCount).map(source => ({
      source,
      count: leadSourceCount[source],
      percent: totalLeads > 0
        ? ((leadSourceCount[source] / totalLeads) * 100).toFixed(0) + "%"
        : "0%"
    }));

    const averageCoachEducationPassMark = averageCallGrade;
    // ========= CONVERT DEMOGRAPHICS TO COUNT + PERCENT =========

    // AGE
    const byAge = Object.keys(ageCount).map(age => ({
      age: Number(age),
      count: ageCount[age],
      percent: ((ageCount[age] / totalLeads) * 100).toFixed(0) + "%"
    }));

    // GENDER
    const byGender = Object.keys(genderCount).map(g => ({
      gender: g,
      count: genderCount[g],
      percent: ((genderCount[g] / totalLeads) * 100).toFixed(0) + "%"
    }));

    // VENUE (with venue name)
    const venues = await Venue.findAll();
    const byVenue = Object.keys(venueCount).map(id => {
      const venue = venues.find(v => v.id == id);
      return {
        venueName: venue ? venue.name : "Unknown",
        count: venueCount[id],
        percent: ((venueCount[id] / totalLeads) * 100).toFixed(0) + "%"
      };
    });

    const highDemandVenues = Object.keys(venueDemandCount).map(id => {
      const venue = venues.find(v => v.id == id);
      return {
        venueName: venue ? venue.name : "Unknown",
        count: venueDemandCount[id],
        percent: totalLeads > 0
          ? ((venueDemandCount[id] / totalLeads) * 100).toFixed(0) + "%"
          : "0%"
      };
    });

    const topAgents = Object.keys(topAgentCount)
      .map(agentId => ({
        agentId,
        firstName: topAgentCount[agentId].firstName,
        lastName: topAgentCount[agentId].lastName,
        totalHires: topAgentCount[agentId].totalHires
      }))
      .sort((a, b) => b.totalHires - a.totalHires); // highest hires first

    // ========= MAIN REPORT =========
    const calcRate = (value, total) =>
      total > 0 ? ((value / total) * 100).toFixed(0) + "%" : "0%";

    const report = {
      totalLeads: {
        current: counters.thisMonth.totalLeads,
        previous: counters.lastMonth.totalLeads,
        conversionRate: calcRate(counters.thisMonth.totalLeads, counters.thisMonth.totalLeads)
      },
      telephoneInterviews: {
        current: counters.thisMonth.telephoneCalls,
        previous: counters.lastMonth.telephoneCalls,
        conversionRate: calcRate(counters.thisMonth.telephoneCalls, counters.thisMonth.totalLeads)
      },
      practicalAssessments: {
        current: counters.thisMonth.practicalAssessments,
        previous: counters.lastMonth.practicalAssessments,
        conversionRate: calcRate(counters.thisMonth.practicalAssessments, counters.thisMonth.totalLeads)
      },
      hires: {
        current: counters.thisMonth.hires,
        previous: counters.lastMonth.hires,
        conversionRate: calcRate(counters.thisMonth.hires, counters.thisMonth.totalLeads)
      },
      conversionRate: {
        current: calcRate(counters.thisMonth.hires, counters.thisMonth.totalLeads),
        previous: calcRate(counters.lastMonth.hires, counters.lastMonth.totalLeads)
      }

    };

    return {
      status: true,
      message: "Recruitment report fetched successfully.",
      data: {
        report,
        chartData,
        demographics: {
          byAge,
          byGender,
          byVenue
        },
        qualifications: {
          faQualification: qualificationStats.faQualification,
          dbsCertificate: qualificationStats.dbsCertificate,
          coachingExperience: qualificationStats.coachingExperience,
          noExperience: qualificationStats.noExperience
        },
        onboardingResults: {
          averageCallGrade: averageCallGrade + "%",
          averagePracticalAssessmentGrade: averagePracticalGrade + "%",
          averageCoachEducationPassMark: averageCoachEducationPassMark + "%"
        },
        sourceOfLeads: byLeadSource,
        highDemandVenues,
        topAgents,
      }
    };

  } catch (error) {
    return {
      status: false,
      message: "Fetch recruitmentLead failed. " + error.message,
    };
  }
};

// ✅ GET ALL - by admin
exports.getAllCoachAndVmRecruitmentLead = async (adminId) => {
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
        createdBy: Number(adminId),
        appliedFor: {
          [Op.in]: ["coach", "venue manager"]   // ⭐ get both
        }
      },

      include: [
        { model: CandidateProfile, as: "candidateProfile" }
      ],
      order: [["createdAt", "DESC"]],
    });

    const formatted = [];

    for (const lead of recruitmentLead) {
      const leadJson = lead.toJSON();
      const profile = leadJson.candidateProfile;

      if (profile?.bookPracticalAssessment) {
        try {
          profile.bookPracticalAssessment = JSON.parse(profile.bookPracticalAssessment);

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
    // ---------- TOTALS FIXED (FOR BOTH COACH + VENUE MANAGER) ----------

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Count all valid applications (having candidateProfile)
    const totalApplications = recruitmentLead.filter(
      (lead) => lead.candidateProfile !== null
    ).length;

    // New applications this month
    const totalNewApplications = recruitmentLead.filter(
      (lead) =>
        lead.candidateProfile !== null &&
        new Date(lead.createdAt).getMonth() === currentMonth &&
        new Date(lead.createdAt).getFullYear() === currentYear
    ).length;

    // Applications that reached assessments
    const totalToAssessments = recruitmentLead.filter(
      (lead) => {
        const book = lead.candidateProfile?.bookPracticalAssessment;

        return book && Array.isArray(book) && book.length > 0;
      }
    ).length;

    // Applications successfully recruited (valid for both coach + venue manager)
    const totalToRecruitment = recruitmentLead.filter(
      (lead) =>
        lead.status === "recruited" && lead.candidateProfile !== null
    ).length;

    // ---------- PERCENTAGES ----------
    const pct = (count) =>
      totalApplications > 0
        ? ((count / totalApplications) * 100).toFixed(2) + "%"
        : "0%";

    return {
      status: true,
      message: "Recruitment lead fetched successfully.",
      totals: [
        {
          name: "totalApplications",
          count: totalApplications,
          percent: pct(totalApplications),
        },
        {
          name: "totalNewApplications",
          count: totalNewApplications,
          percent: pct(totalNewApplications),
        },
        {
          name: "totalToAssessments",
          count: totalToAssessments,
          percent: pct(totalToAssessments),
        },
        {
          name: "totalToRecruitment",
          count: totalToRecruitment,
          percent: pct(totalToRecruitment),
        },
      ],
      data: formatted,
    };

  } catch (error) {
    return {
      status: false,
      message: "Fetch recruitmentLead failed. " + error.message,
    };
  }
};

// venue list
exports.getAllVenues = async (createdBy) => {
  try {
    if (!createdBy || isNaN(Number(createdBy))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const venues = await Venue.findAll({
      where: { createdBy: Number(createdBy) },
      order: [["createdAt", "DESC"]],
      attributes: [
        "id",
        "area",
        "name",
        "address",
        "facility",
        "parkingNote",
        "howToEnterFacility",
        "paymentGroupId",
        "isCongested",
        "hasParking",
        "termGroupId",
        "latitude",
        "longitude",
        "postal_code",
        "createdBy",
        "createdAt",
        "updatedAt",
      ],
    });
    return {
      status: true,
      message: "Venues fetched successfully.",
      data: venues,
    };
  } catch (error) {
    console.error("❌ getAllVenues Error:", error);
    return {
      status: false,
      message: "Failed to fetch venues.",
    };
  }
};
