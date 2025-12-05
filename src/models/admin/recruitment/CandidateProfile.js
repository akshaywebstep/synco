const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CandidateProfile = sequelize.define(
    "CandidateProfile",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        recruitmentLeadId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,  // Changed from false to true
            references: {
                model: "lead_recruitment",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL", // Changed from RESTRICT
        },
        howDidYouHear: { type: DataTypes.STRING, allowNull: false },
        ageGroupExperience: { type: DataTypes.STRING, allowNull: true }, // store like "7-10"
        accessToOwnVehicle: { type: DataTypes.BOOLEAN, allowNull: true },
        whichQualificationYouHave: { type: DataTypes.STRING, allowNull: true },
        footballExperience: { type: DataTypes.STRING, allowNull: true }, // "1 year", "2 years"
        availableVenueWork: { type: DataTypes.JSON, allowNull: true }, // store array of venue IDs or names
        uploadCv: { type: DataTypes.STRING, allowNull: true }, // path to uploaded file
        coverNote: { type: DataTypes.TEXT, allowNull: true },
        qualifyLead: { type: DataTypes.BOOLEAN, allowNull: true },

        // Telephone call setup
        telephoneCallSetupDate: { type: DataTypes.DATEONLY, allowNull: true },
        telephoneCallSetupTime: { type: DataTypes.TIME, allowNull: true },
        telephoneCallSetupReminder: { type: DataTypes.STRING, allowNull: true },
        telephoneCallSetupEmail: { type: DataTypes.STRING, allowNull: true },

        // Telephone call delivery scorecard
        telePhoneCallDeliveryCommunicationSkill: { type: DataTypes.INTEGER, allowNull: true },
        telePhoneCallDeliveryPassionCoaching: { type: DataTypes.INTEGER, allowNull: true },
        telePhoneCallDeliveryExperience: { type: DataTypes.INTEGER, allowNull: true },
        telePhoneCallDeliveryKnowledgeOfSSS: { type: DataTypes.INTEGER, allowNull: true },

        // Practical assessment
        bookPracticalAssessment: {
            type: DataTypes.JSON,
            allowNull: true
            /* Example structure:
            [
              { venueId, classId, date, assignToVenueManager }
            ] 
            */
        },

        result: { type: DataTypes.STRING, allowNull: true },
    },
    {
        tableName: "candidate_profile",
        timestamps: true,
    }
);

module.exports = CandidateProfile;
