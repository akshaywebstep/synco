const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CancelSession = sequelize.define(
  "CancelSession",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    classScheduleId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    // Common fields
    reasonForCancelling: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    notifyMembers: {
      type: DataTypes.ENUM("Yes", "No"),
      defaultValue: "No",
    },
    creditMembers: {
      type: DataTypes.ENUM("Yes", "No"),
      defaultValue: "No",
    },
    notifyTrialists: {
      type: DataTypes.ENUM("Yes", "No"),
      defaultValue: "No",
    },
    notifyCoaches: {
      type: DataTypes.ENUM("Yes", "No"),
      defaultValue: "No",
    },

    // Notifications JSON array
    notifications: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    cancelledAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "cancel_session",
    timestamps: true,
    underscored: false,
  }
);

module.exports = CancelSession;

CancelSession.associate = (models) => {
  CancelSession.belongsTo(models.ClassSchedule, {
    foreignKey: "classScheduleId",
    as: "classSchedule", // this "as" must match the include in the query
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};
