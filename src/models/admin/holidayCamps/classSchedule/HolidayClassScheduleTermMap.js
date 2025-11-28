const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayClassScheduleTermMap = sequelize.define(
  "HolidayClassScheduleTermMap",
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
      comment: "Class schedule associated with Term Map",
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
    // ✅ New status field with default "pending"
    status: {
      type: DataTypes.ENUM("pending", "active", "completed", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
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
  },
  {
    tableName: "holiday_class_schedule_term_maps",
    timestamps: true,
    paranoid: true, // ✅ Enable soft deletes
  }
);

// ✅ Associations
// HolidayClassScheduleTermMap.associate = function (models) {
//   HolidayClassScheduleTermMap.belongsTo(models.HolidayClassSchedule, {
//     foreignKey: "classScheduleId",
//     as: "holidayClassSchedule",
//   });

//   HolidayClassScheduleTermMap.belongsTo(models.HolidayTermGroup, {
//     foreignKey: "holidayCampId",
//     as: "holidayCamp",
//   });

//   HolidayClassScheduleTermMap.belongsTo(models.HolidayTerm, {
//     foreignKey: "holidayCampDateId",
//     as: "holidayCampDate",
//   });

//   HolidayClassScheduleTermMap.belongsTo(models.HolidaySessionPlanGroup, {
//     // matches model name
//     foreignKey: "sessionPlanId",
//     as: "holiday_sessionPlan",
//   });

//   // HolidayClassScheduleTermMap.hasMany(models.HolidayCancelSession, {
//   //   foreignKey: "mapId",      // must match CancelSession.mapId
//   //   as: "HolidayCancelSessions",     // alias to use in include queries
//   //   onDelete: "CASCADE",
//   //   onUpdate: "CASCADE",
//   // });
// };

module.exports = HolidayClassScheduleTermMap;
