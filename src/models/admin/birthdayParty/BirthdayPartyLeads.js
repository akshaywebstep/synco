// models/BirthdayPartyLead.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const BirthdayPartyLead = sequelize.define(
    "BirthdayPartyLead",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },

        parentName: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: "Full name of the parent or guardian",
        },

        childName: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: "Full name of the child",
        },

        age: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: "Age of the child",
        },

        partyDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: "Planned date of the birthday party",
        },

        packageInterest: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "Package or service the parent is interested in",
        },

        source: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "How the lead heard about us (e.g., referral, Facebook, etc.)",
        },

        status: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: "new",
            comment: "Lead status (e.g., new, contacted, booked, lost, etc.)",
        },

        // ✅ Foreign key for the admin who created this lead
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

        // ✅ Soft delete support
        deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },

        deletedBy: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: "admins",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
        },
    },
    {
        tableName: "birthday_party_leads",
        timestamps: true,
        paranoid: true, // enables soft deletes
    }
);
// ✅ Associations (if needed)
BirthdayPartyLead.associate = (models) => {
  // Example: Lead created by an admin
  BirthdayPartyLead.belongsTo(models.Admin, {
    foreignKey: "createdBy",
    as: "creator",
  });

  BirthdayPartyLead.belongsTo(models.Admin, {
    foreignKey: "deletedBy",
    as: "deleter",
  });

  BirthdayPartyLead.hasOne(models.BirthdayPartyBooking, {
    foreignKey: "leadId",
    as: "booking",
  });
};

module.exports = BirthdayPartyLead;
