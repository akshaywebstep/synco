const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidaySessionPlanGroup = sequelize.define(
  "HolidaySessionPlanGroup",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    groupName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    player: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    banner: {
      type: DataTypes.STRING,
    },

    beginner_video: {
      type: DataTypes.STRING,
    },
    advanced_video: {
      type: DataTypes.STRING,
    },
    pro_video: {
      type: DataTypes.STRING,
    },
    intermediate_video: {
      type: DataTypes.STRING,
    },

    beginner_upload: {
      type: DataTypes.STRING,
    },
    advanced_upload: {
      type: DataTypes.STRING,
    },
    pro_upload: {
      type: DataTypes.STRING,
    },
    intermediate_upload: {
      type: DataTypes.STRING,
    },

    levels: {
      type: DataTypes.JSON,
      allowNull: false,
    },

    sortOrder: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },

    pinned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    type: {
      type: DataTypes.ENUM("holiday_camp", "one_to_one", "birthday_party", "library"),
      allowNull: false,
      defaultValue: "weekly_classes",
    },

    // Foreign key for creation
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

    // Soft delete timestamp
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // Foreign key for deletion
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
    tableName: "holiday_session_plan_groups", // ✅ New table name
    timestamps: true,
    paranoid: true, // Soft delete
  }
);

module.exports = HolidaySessionPlanGroup;

// Associations
HolidaySessionPlanGroup.associate = (models) => {
  HolidaySessionPlanGroup.hasMany(models.CancelSession, {
    foreignKey: "sessionPlanGroupId",
    as: "cancelSessions",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};
