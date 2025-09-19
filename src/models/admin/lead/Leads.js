const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Lead = sequelize.define(
  "Lead",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // First Name
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Last Name
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Email Address
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true,
      },
    },

    // Phone number
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Includes country code (e.g., +44)",
    },

    // Postcode
    postcode: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // Age of child
    childAge: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    // Status of lead
    status: {
      type: DataTypes.ENUM("others", "facebook", "referall"),
      allowNull: false,
      defaultValue: "others",
    },
    assignedAgentId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
  },
  {
    tableName: "leads",
    timestamps: true,
  }
);

module.exports = Lead;
