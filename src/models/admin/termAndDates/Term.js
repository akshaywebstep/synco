const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Term = sequelize.define(
  "Term",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    termName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    day: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    endDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    // ✅ Store exclusion dates as JSON array
    exclusionDates: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    totalSessions: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },

    // ✅ Store all sessions in one JSON field
    sessionsMap: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    termGroupId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "term_groups",
        key: "id",
      },
    },

    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "terms",
    timestamps: true,
  }
);

module.exports = Term;
