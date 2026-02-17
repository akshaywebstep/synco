const { CandidateProfile, RecruitmentLead } = require("../../../../models");
const { Op } = require("sequelize");

exports.createCandidateProfile = async (data) => {
    try {
        // Always set CandidateProfile status
        data.status = "recruited";

        if (process.env.DEBUG === "true") {
            console.log("▶️ Data passed to model:", data);
        }

        // Create candidate profile
        const candidateProfile = await CandidateProfile.create(data);

        // ⛔ Only update recruitment lead if qualifyLead === true
        if (data.qualifyLead === true) {
            await RecruitmentLead.update(
                { status: "recruited" },
                { where: { id: data.recruitmentLeadId } }
            );
        }

        return { status: true, data: candidateProfile.get({ plain: true }) };
    } catch (error) {
        console.error("❌ Error creating createCandidateProfile:", error);
        return { status: false, message: error.message };
    }
};
