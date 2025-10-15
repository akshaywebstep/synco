const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const ClassScheduleTermMap = sequelize.define(
  "ClassScheduleTermMap",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    classScheduleId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "class_schedules", // make sure table is snake_case in DB
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Class schedule associated with Term Map",
    },

    termGroupId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "term_groups",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    termId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "terms",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    sessionPlanId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "session_plan_groups",
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
  },
  {
    tableName: "class_schedule_term_maps",
    timestamps: true,
    paranoid: true, // ✅ Enable soft deletes
  }
);

// ✅ Associations
ClassScheduleTermMap.associate = function (models) {
  ClassScheduleTermMap.belongsTo(models.ClassSchedule, {
    foreignKey: "classScheduleId",
    as: "classSchedule",
  });

  ClassScheduleTermMap.belongsTo(models.TermGroup, {
    foreignKey: "termGroupId",
    as: "termGroup",
  });

  ClassScheduleTermMap.belongsTo(models.Term, {
    foreignKey: "termId",
    as: "term",
  });

  ClassScheduleTermMap.belongsTo(models.SessionPlanGroup, {
    // matches model name
    foreignKey: "sessionPlanId",
    as: "sessionPlan",
  });
};

module.exports = ClassScheduleTermMap;
