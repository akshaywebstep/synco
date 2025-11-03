const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const SessionPlanGroup = sequelize.define(
  "SessionPlanGroup",
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
    // video: {
    //   type: DataTypes.STRING,
    // },
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
      type: DataTypes.ENUM("weekly_classes","one_to_one", "birthday_party", "library"),
      allowNull: false,
      defaultValue: 'weekly_classes',
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
    tableName: "session_plan_groups",
    timestamps: true,
    paranoid: true, // ✅ enable soft deletes
  }
);

module.exports = SessionPlanGroup;

SessionPlanGroup.associate = (models) => {
  SessionPlanGroup.hasMany(models.CancelSession, {
    foreignKey: "sessionPlanGroupId",
    as: "cancelSessions", // alias to use when including
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};
