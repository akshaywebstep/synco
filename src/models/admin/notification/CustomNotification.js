// models/CustomNotification.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CustomNotification = sequelize.define(
  "CustomNotification",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    category: {
      type: DataTypes.ENUM(
        "Complaints",
        "Payments",
        "Cancelled Memberships",
        "System",
        "Activity Logs",
        "Security",
        "Login",
        "Settings",
        "Updates",
        "Announcements",
        "Tasks",
        "Messages",
        "Support"
      ),
      allowNull: false,
    },
    adminId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
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
    tableName: "custom_notifications",
    timestamps: false,
    paranoid: true, // ✅ enable soft deletes
  }
);

CustomNotification.associate = function (models) {
  CustomNotification.belongsTo(models.Admin, {
    foreignKey: "adminId",
    as: "admin",
    onDelete: "CASCADE",
  });

  CustomNotification.hasMany(models.CustomNotificationRead, {
    foreignKey: "customNotificationId",
    as: "reads",
    onDelete: "CASCADE",
  });
};

module.exports = CustomNotification;
