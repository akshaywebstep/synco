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
        model: "class_schedules",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
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
  },
  {
    tableName: "class_schedule_term_maps",
    timestamps: true,
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
