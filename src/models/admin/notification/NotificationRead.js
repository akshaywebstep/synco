const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const NotificationRead = sequelize.define(
  "NotificationRead",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    notificationId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    adminId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true, // ✅ allow null
      references: {
        model: "admins",
        key: "id",
      },
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "notification_reads",
    timestamps: false,
  }
);

// ✅ Association
NotificationRead.associate = (models) => {
  NotificationRead.belongsTo(models.Notification, {
    foreignKey: "notificationId",
    as: "notification",
    onDelete: "CASCADE",
  });

  NotificationRead.belongsTo(models.Admin, {
    foreignKey: "adminId",
    as: "admin",
    onDelete: "SET NULL",
  });
};

module.exports = NotificationRead;
