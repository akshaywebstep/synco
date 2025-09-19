const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const SessionExercise = sequelize.define(
  "SessionExercise",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    duration: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    imageUrl: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "session_exercises",
    timestamps: true,
  }
);

module.exports = SessionExercise;
