const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const SessionPlanGroup = sequelize.define(
  "SessionPlanGroup",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    groupName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    player: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    banner: {
      type: DataTypes.STRING,
    },
    video: {
      type: DataTypes.STRING,
    },
    beginner_recording: {
      type: DataTypes.STRING,
    },
    advanced_recording: {
      type: DataTypes.STRING,
    },
    pro_recording: {
      type: DataTypes.STRING,
    }, 
    intermediate_recording: {
      type: DataTypes.STRING,
    },
    levels: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    sortOrder: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "session_plan_groups",
    timestamps: true,
  }
);

module.exports = SessionPlanGroup;
