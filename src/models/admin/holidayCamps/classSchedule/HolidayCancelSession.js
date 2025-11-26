const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayCancelSession = sequelize.define(
  "HolidayCancelSession",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    classScheduleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    mapId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // can be nullable if not linked
      references: {
        model: "holiday_class_schedule_term_maps", // table name
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Reference to ClassScheduleTermMap",
    },

    sessionPlanGroupId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "holiday_session_plan_groups", // table name
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
      type: DataTypes.BIGINT.UNSIGNED,
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
      type: DataTypes.BIGINT.UNSIGNED,
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

module.exports = HolidayCancelSession;

HolidayCancelSession.associate = (models) => {
  HolidayCancelSession.belongsTo(models.HolidayClassSchedule, {
    foreignKey: "classScheduleId",
    as: "holidayClassSchedule", // this "as" must match the include in the query
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  HolidayCancelSession.belongsTo(models.HolidayClassScheduleTermMap, {
    foreignKey: "mapId",
    as: "termMap", // use this alias when including
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  HolidayCancelSession.belongsTo(models.HolidaySessionPlanGroup, {
    foreignKey: "sessionPlanGroupId",
    as: "holidaySessionPlanGroup", // alias to use in queries
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};
