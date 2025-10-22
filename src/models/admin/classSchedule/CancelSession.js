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

    mapId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true, // can be nullable if not linked
      references: {
        model: "class_schedule_term_maps", // table name
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Reference to ClassScheduleTermMap",
    },

    sessionPlanGroupId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "session_plan_groups", // table name
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Reference to SessionPlanGroup",
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

    // ✅ Foreign key to admins table for creation
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },

    // ✅ Soft delete column
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // ✅ Foreign key to admins table for deletion
    deletedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
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
    paranoid: true, // ✅ Enable soft deletes
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

  CancelSession.belongsTo(models.ClassScheduleTermMap, {
    foreignKey: "mapId",
    as: "termMap", // use this alias when including
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  CancelSession.belongsTo(models.SessionPlanGroup, {
    foreignKey: "sessionPlanGroupId",
    as: "sessionPlanGroup", // alias to use in queries
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};
