const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CourseResult = sequelize.define(
  "CourseResult",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    courseId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "courses",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    adminId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    score: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Score percentage",
    },

    passed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "Did user pass the course",
    },

    attemptNumber: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: "Which attempt number",
    },

    answers: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "User submitted answers",
    },

    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "course_results",
    timestamps: true,
  }
);

module.exports = CourseResult;