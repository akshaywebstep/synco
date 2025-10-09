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
    // video: {
    //   type: DataTypes.STRING,
    // },
    beginner_video: {
      type: DataTypes.STRING,
    },
    advanced_video: {
      type: DataTypes.STRING,
    },
    pro_video: {
      type: DataTypes.STRING,
    },
    intermediate_video: {
      type: DataTypes.STRING,
    },

    beginner_upload: {
      type: DataTypes.STRING,
    },
    advanced_upload: {
      type: DataTypes.STRING,
    },
    pro_upload: {
      type: DataTypes.STRING,
    },
    intermediate_upload: {
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

    // add new feild for one to one ->
    pinned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

  },
  {
    tableName: "session_plan_groups",
    timestamps: true,
  }
);

module.exports = SessionPlanGroup;
