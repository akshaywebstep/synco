const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const NotificationRead = sequelize.define(
  "NotificationRead",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    notificationId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    adminId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // ✅ allow null
      references: {
        model: "admins",
        key: "id",
      },
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
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "notification_reads",
    timestamps: false,
    paranoid: true, // ✅ enable soft deletes
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
