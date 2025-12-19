const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const Feedback = sequelize.define(
  "Feedback",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    bookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "bookings",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    classScheduleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "class_schedules",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    venueId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "venues",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    feedbackType: {
      type: DataTypes.ENUM("positive", "negative"),
      allowNull: false,
    },

    category: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    agentAssigned: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    status: {
      type: DataTypes.ENUM("in_process", "resolved"),
      allowNull: false,
      defaultValue: "in_process",
    },

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
    tableName: "feedback",
    timestamps: true,
    paranoid: true
  }
);

module.exports = Feedback;
