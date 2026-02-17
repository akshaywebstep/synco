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
    gender: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
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
      type: DataTypes.STRING,
      allowNull: true,
    },
    availableVenues: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    qualification: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    // 🔹 SECTION 3
    heardFrom: {
      type: DataTypes.ENUM("indeed", "facebook", "google", "referral", "other"),
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

    // for enjury form
    desiredFranchiseLocation: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    liquidCapital: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // 🔹 LEAD SOURCE
    source: {
      type: DataTypes.ENUM("website", "admin", "import"),
      allowNull: false,
      defaultValue: "admin",
    },

    // 🔹 FOREIGN KEY FIELD

    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // ✅ allow null for public submissions
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL", // ✅ recommended when allowNull = true
    },
  },
  {
    tableName: "lead_recruitment",
    timestamps: true,
  }
);

module.exports = RecruitmentLead;
