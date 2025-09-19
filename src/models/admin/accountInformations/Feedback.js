const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Feedback = sequelize.define(
  "Feedback",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // ✅ FK → Booking.id
    bookingId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "booking",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Link feedback with a specific booking",
    },

    // ✅ FK → ClassSchedules.id
    classScheduleId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "class_schedules", // make sure table is snake_case in DB
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Class schedule associated with feedback",
    },

    // Feedback type → Positive / Negative
    feedbackType: {
      type: DataTypes.ENUM("positive", "negative"),
      allowNull: false,
      comment: "Indicates if the feedback is positive or negative",
    },

    // Category (Time, Facility, Coach, etc.)
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Parent’s reason / notes
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // ✅ FK → Admins.id (agent assigned to resolve)
    agentAssigned: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Agent assigned to handle feedback",
    },

    // Status of feedback
    status: {
      type: DataTypes.ENUM("in_process", "resolved"),
      allowNull: false,
      defaultValue: "in_process",
    },

    // Optional resolution notes
    resolutionNote: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Action taken to resolve feedback",
    },
  },
  {
    tableName: "feedback",
    timestamps: true,
  }
);

module.exports = Feedback;
