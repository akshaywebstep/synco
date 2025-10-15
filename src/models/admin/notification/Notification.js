// models/Notification.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
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
        "Discounts",
        "Cancelled Memberships",
        "Members",
        "Member Roles",
        // "Admins",
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
      type: DataTypes.INTEGER.UNSIGNED,
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
    tableName: "notifications",
    timestamps: false,
    paranoid: true, // ✅ enable soft deletes
  }
);

// ✅ Association
Notification.associate = (models) => {
  Notification.belongsTo(models.Admin, {
    foreignKey: "adminId",
    as: "admin",
    onDelete: "CASCADE",
  });

  Notification.hasMany(models.NotificationRead, {
    foreignKey: "notificationId",
    as: "reads",
    onDelete: "CASCADE",
  });
};

module.exports = Notification;
