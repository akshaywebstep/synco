const { RecruitmentLead, CandidateProfile, Venue, ClassSchedule, Admin } = require("../../../../models");
const { Op } = require("sequelize");

exports.createRecruitmentVmLead = async (data) => {
  try {
    data.status = "pending";
    if (process.env.DEBUG === "true") {
      console.log("▶️ Data passed to model:", data);
    }

    const recruitmentVmLead = await RecruitmentLead.create(data);

    return { status: true, data: recruitmentVmLead.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error creating createRecruitmentVmLead:", error);
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
        createdBy: Number(adminId),
        appliedFor: "venue manager"  // ⭐ static filter added here
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
      where: { id }, // remove createdBy filter
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
      return { status: false, message: "recruitmentLead not found or unauthorized.", data: {} };
    }

    // Convert to JSON
    const leadJson = recruitmentLead.toJSON();
    const profile = leadJson.candidateProfile || {};

    // Parse bookPracticalAssessment if exists
    if (profile.bookPracticalAssessment) {
      try {
        profile.bookPracticalAssessment = JSON.parse(profile.bookPracticalAssessment);

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
