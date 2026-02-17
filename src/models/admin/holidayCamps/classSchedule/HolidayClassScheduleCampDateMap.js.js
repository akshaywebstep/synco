const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayClassScheduleCampDateMap = sequelize.define(
  "HolidayClassScheduleCampDateMap",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    classScheduleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "holiday_class_schedules",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Class schedule associated with Camp Date Map",
    },

    holidayCampId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "holiday_camp",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    holidayCampDateId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "holiday_camp_dates",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    sessionPlanId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "holiday_session_plan_groups",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    status: {
      type: DataTypes.ENUM("pending", "active", "completed", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
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

    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
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
    tableName: "holiday_class_schedule_campDate_maps",
    timestamps: true,
    paranoid: true, // Enable soft deletes
  }
);

// ✅ Associations
HolidayClassScheduleCampDateMap.associate = function (models) {
  HolidayClassScheduleCampDateMap.belongsTo(models.HolidayClassSchedule, {
    foreignKey: "classScheduleId",
    as: "holidayClassSchedule",
  });

  HolidayClassScheduleCampDateMap.belongsTo(models.HolidayCamp, {
    foreignKey: "holidayCampId",
    as: "holidayCamp",
  });

  HolidayClassScheduleCampDateMap.belongsTo(models.HolidayCampDates, {
    foreignKey: "holidayCampDateId",
    as: "holidayCampDate",
  });

  HolidayClassScheduleCampDateMap.belongsTo(models.HolidaySessionPlanGroup, {
    foreignKey: "sessionPlanId",
    as: "holiday_sessionPlan",
  });

  HolidayClassScheduleCampDateMap.hasMany(models.HolidayCancelSession, {
    foreignKey: "mapId",
    as: "HolidayCancelSessions",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};

module.exports = HolidayClassScheduleCampDateMap;
