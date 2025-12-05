const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const RecruitmentLead = sequelize.define(
    "RecruitmentLead",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        // 🔹 BASIC INFO
        firstName: { type: DataTypes.STRING, allowNull: false },
        lastName: { type: DataTypes.STRING, allowNull: false },
        dob: { type: DataTypes.DATEONLY, allowNull: true },
        age: { type: DataTypes.INTEGER, allowNull: true },

        email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            // validate: {
            //     isEmail: true,
            // }
        },
        // ⭐ NEW FIELD
        appliedFor: {
            type: DataTypes.ENUM("venue manager", "coach", "franchise"),
            allowNull: false,
            defaultValue: "coach",
        },

        phoneNumber: { type: DataTypes.STRING, allowNull: true },

        postcode: { type: DataTypes.STRING, allowNull: true },

        managementExperience: {
            type: DataTypes.ENUM(
                "1 year",
                "2 years",
                "3 years",
                "4 years",
                "5 years"
            ),
            allowNull: true,
        },

        dbs: {
            type: DataTypes.ENUM("yes", "no"),
            allowNull: true,
        },
        level: {
            type: DataTypes.ENUM("yes", "no"),
            allowNull: true,
        },

        status: {
            type: DataTypes.ENUM("pending", "recruited", "rejected"),
            defaultValue: "pending",
            allowNull: false,
        },

        // 🔹 FOREIGN KEY FIELD

        createdBy: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "admins",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "RESTRICT",
        },
    },
    {
        tableName: "lead_recruitment",
        timestamps: true,
    }
);

module.exports = RecruitmentLead;
