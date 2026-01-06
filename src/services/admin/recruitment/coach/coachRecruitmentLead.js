const { RecruitmentLead, CandidateProfile, Venue, ClassSchedule, Admin, AdminRole } = require("../../../../models");

const { getEmailConfig } = require("../../../../services/email");
const sendEmail = require("../../../../utils/email/sendEmail");
const emailModel = require("../../../../services/email");
const moment = require("moment");
const { Op } = require("sequelize");

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
      if (profile?.availableVenueWork) {
        try {
          const venueIds = Array.isArray(profile.availableVenueWork)
            ? profile.availableVenueWork
            : JSON.parse(profile.availableVenueWork);

          const venues = await Venue.findAll({
            where: {
              id: venueIds
            }
          });

          profile.availableVenueWork = {
            ids: venueIds,
            venues: venues.map(v => v.toJSON())
          };

        } catch (err) {
          profile.availableVenueWork = {
            ids: [],
            venues: []
          };
        }
      }

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
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // current year leads
    const currentYearLeads = recruitmentLead.filter(
      lead => new Date(lead.createdAt).getFullYear() === currentYear
    );

    const totalApplications = currentYearLeads.length;

    const totalNewApplications = currentYearLeads.filter(
      lead => new Date(lead.createdAt).getMonth() === currentMonth
    ).length;

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

    const totalToRecruitment = currentYearLeads.filter(
      lead => lead.status === "recruited"
    ).length;

    const percent = (count) =>
      totalApplications > 0
        ? ((count / totalApplications) * 100).toFixed(2) + "%"
        : "0%";
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
exports.getAllRecruitmentLeadRport = async (adminId, dateRange) => {
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
      startDate = moment().startOf("year").toDate();  // Jan 1 current year
      endDate = moment().endOf("year").toDate();      // Dec 31 current year

      prevStartDate = moment(startDate).subtract(1, "year").startOf("day").toDate();
      prevEndDate = moment(endDate).subtract(1, "year").endOf("day").toDate();

    } else if (dateRange === "thisMonth") {
      startDate = moment().startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(1, "month").startOf("month").toDate();
      prevEndDate = moment(endDate).subtract(1, "month").endOf("month").toDate();

    } else if (dateRange === "lastMonth") {
      startDate = moment().subtract(1, "month").startOf("month").toDate();
      endDate = moment().subtract(1, "month").endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(1, "month").startOf("month").toDate();
      prevEndDate = moment(endDate).subtract(1, "month").endOf("month").toDate();

    } else if (dateRange === "last3Months") {
      startDate = moment().subtract(3, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(3, "months").startOf("month").toDate();
      prevEndDate = moment(startDate).subtract(1, "day").endOf("day").toDate();

    } else if (dateRange === "last6Months") {
      startDate = moment().subtract(6, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(6, "months").startOf("month").toDate();
      prevEndDate = moment(startDate).subtract(1, "day").endOf("day").toDate();

    } else {
      throw new Error("Invalid dateRange");
    }

    const combinedStart = prevStartDate;
    const combinedEnd = endDate;

    const recruitmentLead = await RecruitmentLead.findAll({
      where: {
        createdBy: Number(adminId),
        createdAt: {
          [Op.between]: [combinedStart, combinedEnd]
        },
        appliedFor: "coach",
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
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    // ================= CHART DATA =================
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

    // ================= YEARLY REPORT COUNTERS =================
    // Keep original keys thisYear / lastYear as per your final response
    const yearlyCounters = {
      thisYear: { totalLeads: 0, telephoneCalls: 0, practicalAssessments: 0, hires: 0 },
      lastYear: { totalLeads: 0, telephoneCalls: 0, practicalAssessments: 0, hires: 0 }
    };

    const yearlyTelephoneLeadSet = {
      thisYear: new Set(),
      lastYear: new Set()
    };
    const yearlyHiredLeadSet = {
      thisYear: new Set(),
      lastYear: new Set()
    };

    // ================= OTHER STATS =================
    const qualificationStats = {
      faQualification: 0,
      dbsCertificate: 0,
      coachingExperience: 0,
      noExperience: 0
    };

    const ageCount = {};
    const genderCount = { Male: 0, Female: 0, Others: 0 };
    const venueCount = {};
    const venueDemandCount = {};
    const leadSourceCount = {};
    const topAgentCount = {};

    const normalizePercent = (items) => {
      const total = items.reduce((s, i) => s + i.count, 0);
      return items.map(i => ({
        ...i,
        percent: total > 0 ? ((i.count / total) * 100).toFixed(0) + "%" : "0%"
      }));
    };

    let totalCallScore = 0;
    let totalCallMax = 0;
    let totalPracticalLeadsWithAssessment = 0;

    // ================= LOOP =================
    for (const lead of recruitmentLead) {
      const created = new Date(lead.createdAt);
      const leadYear = created.getFullYear();
      const leadMonth = created.getMonth();
      const monthName = monthNames[leadMonth];
      const profile = lead.candidateProfile;

      // Assign bucket based on date range, keep keys consistent with final response
      let bucket = null;
      if (created >= startDate && created <= endDate) {
        bucket = yearlyCounters.thisYear;
      } else if (created >= prevStartDate && created <= prevEndDate) {
        bucket = yearlyCounters.lastYear;
      } else {
        continue; // out of combined range, skip
      }

      // ===== TOTAL LEADS =====
      if (["pending", "recruited", "reject"].includes(lead.status)) {
        bucket.totalLeads++;
      }

      // ===== TELEPHONE =====
      if (profile?.telephoneCallSetupDate && profile?.telephoneCallSetupTime) {
        bucket.telephoneCalls++;

        if (created >= startDate && created <= endDate) {
          yearlyTelephoneLeadSet.thisYear.add(lead.id);
        } else if (created >= prevStartDate && created <= prevEndDate) {
          yearlyTelephoneLeadSet.lastYear.add(lead.id);
        }
      }

      // ===== PRACTICAL / HIRES =====
      let booked = profile?.bookPracticalAssessment;
      if (typeof booked === "string") {
        try { booked = JSON.parse(booked); } catch { booked = []; }
      }

      if (lead.status === "recruited") {
        bucket.hires++;

        if (created >= startDate && created <= endDate) {
          yearlyHiredLeadSet.thisYear.add(lead.id);
        } else if (created >= prevStartDate && created <= prevEndDate) {
          yearlyHiredLeadSet.lastYear.add(lead.id);
        }

        if (Array.isArray(booked) && booked.length > 0) {
          bucket.practicalAssessments++;
        }
      }

      // ===== CHART DATA =====
      if (["pending", "recruited"].includes(lead.status)) {
        if (created >= startDate && created <= endDate) chartData.leads.currentYear[monthName]++;
        if (created >= prevStartDate && created <= prevEndDate) chartData.leads.lastYear[monthName]++;
      }
      if (lead.status === "recruited") {
        if (created >= startDate && created <= endDate) chartData.hires.currentYear[monthName]++;
        if (created >= prevStartDate && created <= prevEndDate) chartData.hires.lastYear[monthName]++;
      }

      // ===== AGE =====
      if (lead.age) ageCount[lead.age] = (ageCount[lead.age] || 0) + 1;

      // ===== GENDER =====
      let gender = (lead.gender || "Others").toLowerCase();
      if (gender === "male" || gender === "m") gender = "Male";
      else if (gender === "female" || gender === "f") gender = "Female";
      else gender = "Others";
      genderCount[gender]++;

      // ===== QUALIFICATION =====
      if (lead.level === "yes") qualificationStats.faQualification++;
      if (lead.dbs === "yes") qualificationStats.dbsCertificate++;
      if (lead.managementExperience === "yes") {
        qualificationStats.coachingExperience++;
      } else {
        qualificationStats.noExperience++;
      }

      // ===== ONBOARDING =====
      if (profile) {
        const skills = [
          profile.telePhoneCallDeliveryCommunicationSkill,
          profile.telePhoneCallDeliveryPassionCoaching,
          profile.telePhoneCallDeliveryExperience,
          profile.telePhoneCallDeliveryKnowledgeOfSSS
        ].filter(s => typeof s === "number");

        if (skills.length) {
          totalCallScore += skills.reduce((a, b) => a + b, 0);
          totalCallMax += skills.length * 5;
        }
      }

      if (Array.isArray(booked) && booked.length) {
        totalPracticalLeadsWithAssessment++;
      }

      // ===== SOURCE =====
      const source = profile?.howDidYouHear?.trim() || "Other";
      leadSourceCount[source] = (leadSourceCount[source] || 0) + 1;

      // ===== VENUE =====
      if (Array.isArray(booked)) {
        for (const b of booked) {
          if (b?.venueId) {
            venueCount[b.venueId] = (venueCount[b.venueId] || 0) + 1;
            venueDemandCount[b.venueId] = (venueDemandCount[b.venueId] || 0) + 1;
          }
        }
      }

      // ===== TOP AGENT =====
      if (lead.status === "recruited") {
        const id = lead.creator?.id;
        if (!id) continue;

        if (!topAgentCount[id]) {
          topAgentCount[id] = {
            firstName: lead.creator.firstName,
            lastName: lead.creator.lastName,
            profile: lead.creator.profile,
            totalHires: 0
          };
        }
        topAgentCount[id].totalHires++;
      }
    }

    // ================= FINAL CALCS =================
    const totalLeads = yearlyCounters.thisYear.totalLeads + yearlyCounters.lastYear.totalLeads;

    const averageCallGrade = totalCallMax > 0 ? Math.round((totalCallScore / totalCallMax) * 100) : 0;

    const averagePracticalGrade = totalLeads > 0
      ? Math.round((totalPracticalLeadsWithAssessment / totalLeads) * 100)
      : 0;

    const calcRate = (v, t) => (t > 0 ? ((v / t) * 100).toFixed(0) + "%" : "0%");

    // ---- Normalize leadSource percent with rounding fix to sum 100%
    const totalCounted = Object.values(leadSourceCount).reduce((sum, val) => sum + val, 0);

    let runningPercents = 0;

    const byLeadSource = Object.keys(leadSourceCount).map((source, index, arr) => {
      const count = leadSourceCount[source];

      if (index < arr.length - 1) {
        const percentNum = Math.round((count / totalCounted) * 100);
        runningPercents += percentNum;
        return {
          source,
          count,
          percent: percentNum + "%"
        };
      } else {
        const percentNum = 100 - runningPercents;
        return {
          source,
          count,
          percent: percentNum + "%"
        };
      }
    });

    // ---- Other normalized percentages
    const byAge = normalizePercent(
      Object.keys(ageCount).map(age => ({
        age: Number(age),
        count: ageCount[age]
      }))
    );

    const byGender = normalizePercent(
      Object.keys(genderCount).map(g => ({
        gender: g,
        count: genderCount[g]
      }))
    );

    const venues = await Venue.findAll();

    const byVenue = normalizePercent(
      Object.keys(venueCount).map(id => {
        const venue = venues.find(v => v.id == id);
        return {
          venueName: venue ? venue.name : "Unknown",
          count: venueCount[id]
        };
      })
    );

    // ---- High demand venues with percent sum to 100%
    const totalDemandCount = Object.values(venueDemandCount).reduce((sum, val) => sum + val, 0);

    let runningPercent = 0;

    const highDemandVenues = Object.keys(venueDemandCount).map((id, index, arr) => {
      const venue = venues.find(v => v.id == id);
      const count = venueDemandCount[id];

      if (index < arr.length - 1) {
        const percentNum = Math.round((count / totalDemandCount) * 100);
        runningPercent += percentNum;
        return {
          venueName: venue ? venue.name : "Unknown",
          count,
          percent: percentNum + "%"
        };
      } else {
        const percentNum = 100 - runningPercent;
        return {
          venueName: venue ? venue.name : "Unknown",
          count,
          percent: percentNum + "%"
        };
      }
    });

    const topAgents = Object.keys(topAgentCount)
      .map(id => ({
        agentId: id,
        ...topAgentCount[id]
      }))
      .sort((a, b) => b.totalHires - a.totalHires);

    console.log("Filtering date range:", startDate, "to", endDate);
    console.log("Total leads fetched:", recruitmentLead.length);

    // ================= REPORT (SAME STRUCTURE) =================
    const report = {
      totalLeads: {
        current: yearlyCounters.thisYear.totalLeads,
        previous: yearlyCounters.lastYear.totalLeads,
        conversionRate: calcRate(yearlyCounters.thisYear.totalLeads, yearlyCounters.lastYear.totalLeads)
      },

      telephoneInterviews: {
        current: yearlyCounters.thisYear.telephoneCalls,
        previous: yearlyCounters.lastYear.telephoneCalls,
        conversionRate: calcRate(yearlyTelephoneLeadSet.thisYear.size, yearlyCounters.thisYear.totalLeads)
      },

      practicalAssessments: {
        current: yearlyCounters.thisYear.practicalAssessments,
        previous: yearlyCounters.lastYear.practicalAssessments,
        conversionRate: calcRate(yearlyCounters.thisYear.practicalAssessments, yearlyTelephoneLeadSet.thisYear.size)
      },

      hires: {
        current: yearlyCounters.thisYear.hires,
        previous: yearlyCounters.lastYear.hires,
        conversionRate: calcRate(yearlyHiredLeadSet.thisYear.size, yearlyTelephoneLeadSet.thisYear.size)
      },

      conversionRate: {
        current: calcRate(yearlyHiredLeadSet.thisYear.size, yearlyCounters.thisYear.totalLeads),
        previous: calcRate(yearlyHiredLeadSet.lastYear.size, yearlyCounters.lastYear.totalLeads)
      }
    };

    return {
      status: true,
      message: "Recruitment report fetched successfully.",
      data: {
        report,
        chartData,
        demographics: { byAge, byGender, byVenue },
        qualifications: qualificationStats,
        onboardingResults: {
          averageCallGrade: averageCallGrade + "%",
          averagePracticalAssessmentGrade: averagePracticalGrade + "%",
          averageCoachEducationPassMark: averageCallGrade + "%"
        },
        sourceOfLeads: byLeadSource,
        highDemandVenues,
        topAgents
      }
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

    // ------------------------------------------
    // 2️⃣ Choose template based on lead.status
    // ------------------------------------------
    let templateType = "candidate-profile-reject"; // default

    if (lead.status === "venue manager") {
      templateType = "venue-manager-reject";   // <-- your new template
    } else if (lead.status === "coach") {
      templateType = "coach-reject";           // <-- optional coach template
    }

    // ------------------------------------------
    // 3️⃣ Load email template
    // ------------------------------------------
    const { status: configStatus, emailConfig, htmlTemplate, subject } =
      await emailModel.getEmailConfig("admin", templateType);

    if (!configStatus || !htmlTemplate) {
      return { status: false, message: "Email template not configured.", sentTo: [] };
    }

    // 4️⃣ Prepare email body
    const htmlBody = htmlTemplate
      .replace(/{{candidateName}}/g, candidateName)
      .replace(/{{email}}/g, lead.email)
      .replace(/{{applicationStatus}}/g, lead.status)
      .replace(/{{adminName}}/g, adminName)
      .replace(/{{year}}/g, new Date().getFullYear().toString());

    // 5️⃣ Send email
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

exports.getAllRecruitmentLeadRport = async (adminId, dateRange) => {
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
      startDate = moment().startOf("year").toDate();  // Jan 1 current year
      endDate = moment().endOf("year").toDate();      // Dec 31 current year

      prevStartDate = moment(startDate).subtract(1, "year").startOf("day").toDate();
      prevEndDate = moment(endDate).subtract(1, "year").endOf("day").toDate();

    } else if (dateRange === "thisMonth") {
      startDate = moment().startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(1, "month").startOf("month").toDate();
      prevEndDate = moment(endDate).subtract(1, "month").endOf("month").toDate();

    } else if (dateRange === "lastMonth") {
      startDate = moment().subtract(1, "month").startOf("month").toDate();
      endDate = moment().subtract(1, "month").endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(1, "month").startOf("month").toDate();
      prevEndDate = moment(endDate).subtract(1, "month").endOf("month").toDate();

    } else if (dateRange === "last3Months") {
      startDate = moment().subtract(3, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(3, "months").startOf("month").toDate();
      prevEndDate = moment(startDate).subtract(1, "day").endOf("day").toDate();

    } else if (dateRange === "last6Months") {
      startDate = moment().subtract(6, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();

      prevStartDate = moment(startDate).subtract(6, "months").startOf("month").toDate();
      prevEndDate = moment(startDate).subtract(1, "day").endOf("day").toDate();

    } else {
      throw new Error("Invalid dateRange");
    }

    const combinedStart = prevStartDate;
    const combinedEnd = endDate;

    const recruitmentLead = await RecruitmentLead.findAll({
      where: {
        createdBy: Number(adminId),
        createdAt: {
          [Op.between]: [combinedStart, combinedEnd]
        },
        appliedFor: "coach",
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
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    // ================= CHART DATA =================
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

    // ================= YEARLY REPORT COUNTERS =================
    // Keep original keys thisYear / lastYear as per your final response
    const yearlyCounters = {
      thisYear: { totalLeads: 0, telephoneCalls: 0, practicalAssessments: 0, hires: 0 },
      lastYear: { totalLeads: 0, telephoneCalls: 0, practicalAssessments: 0, hires: 0 }
    };

    const yearlyTelephoneLeadSet = {
      thisYear: new Set(),
      lastYear: new Set()
    };
    const yearlyHiredLeadSet = {
      thisYear: new Set(),
      lastYear: new Set()
    };

    // ================= OTHER STATS =================
    const qualificationStats = {
      faQualification: 0,
      dbsCertificate: 0,
      coachingExperience: 0,
      noExperience: 0
    };

    const ageCount = {};
    const genderCount = { Male: 0, Female: 0, Others: 0 };
    const venueCount = {};
    const venueDemandCount = {};
    const leadSourceCount = {};
    const topAgentCount = {};

    const normalizePercent = (items) => {
      const total = items.reduce((s, i) => s + i.count, 0);
      return items.map(i => ({
        ...i,
        percent: total > 0 ? ((i.count / total) * 100).toFixed(0) + "%" : "0%"
      }));
    };

    let totalCallScore = 0;
    let totalCallMax = 0;
    let totalPracticalLeadsWithAssessment = 0;

    // ================= LOOP =================
    for (const lead of recruitmentLead) {
      const created = new Date(lead.createdAt);
      const leadYear = created.getFullYear();
      const leadMonth = created.getMonth();
      const monthName = monthNames[leadMonth];
      const profile = lead.candidateProfile;

      // Assign bucket based on date range, keep keys consistent with final response
      let bucket = null;
      if (created >= startDate && created <= endDate) {
        bucket = yearlyCounters.thisYear;
      } else if (created >= prevStartDate && created <= prevEndDate) {
        bucket = yearlyCounters.lastYear;
      } else {
        continue; // out of combined range, skip
      }

      // ===== TOTAL LEADS =====
      if (["pending", "recruited", "reject"].includes(lead.status)) {
        bucket.totalLeads++;
      }

      // ===== TELEPHONE =====
      if (profile?.telephoneCallSetupDate && profile?.telephoneCallSetupTime) {
        bucket.telephoneCalls++;

        if (created >= startDate && created <= endDate) {
          yearlyTelephoneLeadSet.thisYear.add(lead.id);
        } else if (created >= prevStartDate && created <= prevEndDate) {
          yearlyTelephoneLeadSet.lastYear.add(lead.id);
        }
      }

      // ===== PRACTICAL / HIRES =====
      let booked = profile?.bookPracticalAssessment;
      if (typeof booked === "string") {
        try { booked = JSON.parse(booked); } catch { booked = []; }
      }

      if (lead.status === "recruited") {
        bucket.hires++;

        if (created >= startDate && created <= endDate) {
          yearlyHiredLeadSet.thisYear.add(lead.id);
        } else if (created >= prevStartDate && created <= prevEndDate) {
          yearlyHiredLeadSet.lastYear.add(lead.id);
        }

        if (Array.isArray(booked) && booked.length > 0) {
          bucket.practicalAssessments++;
        }
      }

      // ===== CHART DATA =====
      if (["pending", "recruited"].includes(lead.status)) {
        if (created >= startDate && created <= endDate) chartData.leads.currentYear[monthName]++;
        if (created >= prevStartDate && created <= prevEndDate) chartData.leads.lastYear[monthName]++;
      }
      if (lead.status === "recruited") {
        if (created >= startDate && created <= endDate) chartData.hires.currentYear[monthName]++;
        if (created >= prevStartDate && created <= prevEndDate) chartData.hires.lastYear[monthName]++;
      }

      // ===== AGE =====
      if (lead.age) ageCount[lead.age] = (ageCount[lead.age] || 0) + 1;

      // ===== GENDER =====
      let gender = (lead.gender || "Others").toLowerCase();
      if (gender === "male" || gender === "m") gender = "Male";
      else if (gender === "female" || gender === "f") gender = "Female";
      else gender = "Others";
      genderCount[gender]++;

      // ===== QUALIFICATION =====
      if (lead.level === "yes") qualificationStats.faQualification++;
      if (lead.dbs === "yes") qualificationStats.dbsCertificate++;
      if (lead.managementExperience === "yes") {
        qualificationStats.coachingExperience++;
      } else {
        qualificationStats.noExperience++;
      }

      // ===== ONBOARDING =====
      if (profile) {
        const skills = [
          profile.telePhoneCallDeliveryCommunicationSkill,
          profile.telePhoneCallDeliveryPassionCoaching,
          profile.telePhoneCallDeliveryExperience,
          profile.telePhoneCallDeliveryKnowledgeOfSSS
        ].filter(s => typeof s === "number");

        if (skills.length) {
          totalCallScore += skills.reduce((a, b) => a + b, 0);
          totalCallMax += skills.length * 5;
        }
      }

      if (Array.isArray(booked) && booked.length) {
        totalPracticalLeadsWithAssessment++;
      }

      // ===== SOURCE =====
      const source = profile?.howDidYouHear?.trim() || "Other";
      leadSourceCount[source] = (leadSourceCount[source] || 0) + 1;

      // ===== VENUE =====
      if (Array.isArray(booked)) {
        for (const b of booked) {
          if (b?.venueId) {
            venueCount[b.venueId] = (venueCount[b.venueId] || 0) + 1;
            venueDemandCount[b.venueId] = (venueDemandCount[b.venueId] || 0) + 1;
          }
        }
      }

      // ===== TOP AGENT =====
      // ===== TOP AGENT (CURRENT YEAR ONLY) =====
      if (lead.status === "recruited" && lead.creator) {
        const createdYear = new Date(lead.createdAt).getFullYear();
        if (createdYear !== CURRENT_YEAR) continue; // only current year

        const agentId = lead.creator.id;
        if (!agentId) continue; // skip if no ID

        // Initialize if not already
        if (!topAgentCount[agentId]) {
          topAgentCount[agentId] = {
            firstName: lead.creator.firstName || "",
            lastName: lead.creator.lastName || "",
            profile: lead.creator.profile || "",
            totalHires: 0
          };
        }

        // Increment current year hires
        topAgentCount[agentId].totalHires++;
      }

    }

    // ================= FINAL CALCS =================
    const totalLeads = yearlyCounters.thisYear.totalLeads + yearlyCounters.lastYear.totalLeads;

    const averageCallGrade = totalCallMax > 0 ? Math.round((totalCallScore / totalCallMax) * 100) : 0;

    const averagePracticalGrade = totalLeads > 0
      ? Math.round((totalPracticalLeadsWithAssessment / totalLeads) * 100)
      : 0;

    const calcRate = (v, t) => (t > 0 ? ((v / t) * 100).toFixed(0) + "%" : "0%");

    // ---- Normalize leadSource percent with rounding fix to sum 100%
    const totalCounted = Object.values(leadSourceCount).reduce((sum, val) => sum + val, 0);

    let runningPercents = 0;

    const byLeadSource = Object.keys(leadSourceCount).map((source, index, arr) => {
      const count = leadSourceCount[source];

      if (index < arr.length - 1) {
        const percentNum = Math.round((count / totalCounted) * 100);
        runningPercents += percentNum;
        return {
          source,
          count,
          percent: percentNum + "%"
        };
      } else {
        const percentNum = 100 - runningPercents;
        return {
          source,
          count,
          percent: percentNum + "%"
        };
      }
    });

    // ---- Other normalized percentages
    const byAge = normalizePercent(
      Object.keys(ageCount).map(age => ({
        age: Number(age),
        count: ageCount[age]
      }))
    );

    const byGender = normalizePercent(
      Object.keys(genderCount).map(g => ({
        gender: g,
        count: genderCount[g]
      }))
    );

    const venues = await Venue.findAll();

    const byVenue = normalizePercent(
      Object.keys(venueCount).map(id => {
        const venue = venues.find(v => v.id == id);
        return {
          venueName: venue ? venue.name : "Unknown",
          count: venueCount[id]
        };
      })
    );

    // ---- High demand venues with percent sum to 100%
    const totalDemandCount = Object.values(venueDemandCount).reduce((sum, val) => sum + val, 0);

    let runningPercent = 0;

    const highDemandVenues = Object.keys(venueDemandCount).map((id, index, arr) => {
      const venue = venues.find(v => v.id == id);
      const count = venueDemandCount[id];

      if (index < arr.length - 1) {
        const percentNum = Math.round((count / totalDemandCount) * 100);
        runningPercent += percentNum;
        return {
          venueName: venue ? venue.name : "Unknown",
          count,
          percent: percentNum + "%"
        };
      } else {
        const percentNum = 100 - runningPercent;
        return {
          venueName: venue ? venue.name : "Unknown",
          count,
          percent: percentNum + "%"
        };
      }
    });

    const topAgents = Object.keys(topAgentCount)
      .map(id => ({
        agentId: id,
        ...topAgentCount[id]
      }))
      .sort((a, b) => b.totalHires - a.totalHires);

    console.log("Filtering date range:", startDate, "to", endDate);
    console.log("Total leads fetched:", recruitmentLead.length);

    // ================= REPORT (SAME STRUCTURE) =================
    const report = {
      totalLeads: {
        current: yearlyCounters.thisYear.totalLeads,
        previous: yearlyCounters.lastYear.totalLeads,
        conversionRate: calcRate(yearlyCounters.thisYear.totalLeads, yearlyCounters.lastYear.totalLeads)
      },

      telephoneInterviews: {
        current: yearlyCounters.thisYear.telephoneCalls,
        previous: yearlyCounters.lastYear.telephoneCalls,
        conversionRate: calcRate(yearlyTelephoneLeadSet.thisYear.size, yearlyCounters.thisYear.totalLeads)
      },

      practicalAssessments: {
        current: yearlyCounters.thisYear.practicalAssessments,
        previous: yearlyCounters.lastYear.practicalAssessments,
        conversionRate: calcRate(yearlyCounters.thisYear.practicalAssessments, yearlyTelephoneLeadSet.thisYear.size)
      },

      hires: {
        current: yearlyCounters.thisYear.hires,
        previous: yearlyCounters.lastYear.hires,
        conversionRate: calcRate(yearlyHiredLeadSet.thisYear.size, yearlyTelephoneLeadSet.thisYear.size)
      },

      conversionRate: {
        current: calcRate(yearlyHiredLeadSet.thisYear.size, yearlyCounters.thisYear.totalLeads),
        previous: calcRate(yearlyHiredLeadSet.lastYear.size, yearlyCounters.lastYear.totalLeads)
      }
    };

    return {
      status: true,
      message: "Recruitment report fetched successfully.",
      data: {
        report,
        chartData,
        demographics: { byAge, byGender, byVenue },
        qualifications: qualificationStats,
        onboardingResults: {
          averageCallGrade: averageCallGrade + "%",
          averagePracticalAssessmentGrade: averagePracticalGrade + "%",
          averageCoachEducationPassMark: averageCallGrade + "%"
        },
        sourceOfLeads: byLeadSource,
        highDemandVenues,
        topAgents
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
      if (profile?.availableVenueWork) {
        try {
          const venueIds = Array.isArray(profile.availableVenueWork)
            ? profile.availableVenueWork
            : JSON.parse(profile.availableVenueWork);

          const venues = await Venue.findAll({
            where: {
              id: venueIds
            }
          });

          profile.availableVenueWork = {
            ids: venueIds,
            venues: venues.map(v => v.toJSON())
          };

        } catch (err) {
          profile.availableVenueWork = {
            ids: [],
            venues: []
          };
        }
      }
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

// venue list with class schedules
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
      include: [
        {
          model: ClassSchedule,
          as: "classSchedules",
          attributes: [
            "id",
            "className",
            "startTime",
            "endTime",
            "day",
            "capacity",
            "createdAt",
            "updatedAt",
          ],
        },
      ],
    });

    return {
      status: true,
      message: "Venues with class schedules fetched successfully.",
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

// Get all admins
exports.getAllVenueManager = async (superAdminId, includeSuperAdmin = false) => {
  if (!superAdminId || isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "No valid coach found for this request.",
      data: [],
    };
  }

  try {
    const whereCondition = includeSuperAdmin
      ? {
        [Op.or]: [
          { superAdminId: Number(superAdminId) },
          { id: Number(superAdminId) },
        ],
      }
      : { superAdminId: Number(superAdminId) };

    const admins = await Admin.findAll({
      where: whereCondition,
      attributes: { exclude: ["password", "resetOtp", "resetOtpExpiry"] },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: { role: "admin" },  // 🔥 Filter only COACH role
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} admin(s) successfully.`,
      data: admins,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllVenueManager:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch venue manager.",
    };
  }
};