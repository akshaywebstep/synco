// models/CustomNotificationRead.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CustomNotificationRead = sequelize.define(
  "CustomNotificationRead",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    customNotificationId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    adminId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "custom_notification_reads",
    timestamps: false,
  }
);

// CustomNotificationRead.associate = (models) => {
//   CustomNotificationRead.belongsTo(models.CustomNotification, {
//     foreignKey: "customNotificationId",
//     as: "notification",
//     onDelete: "CASCADE",
//   });

//   CustomNotificationRead.belongsTo(models.Admin, {
//     foreignKey: "adminId",
//     as: "admin", // << this is the alias you MUST use in `include`
//   });
// };

CustomNotificationRead.associate = (models) => {
  // Link to notification
  CustomNotificationRead.belongsTo(models.CustomNotification, {
    foreignKey: "customNotificationId",
    as: "notification",
    onDelete: "CASCADE",
  });

  // Link to Admin (recipient)
  CustomNotificationRead.belongsTo(models.Admin, {
    foreignKey: "adminId",
    as: "admin",
    onDelete: "SET NULL",
  });
};

module.exports = CustomNotificationRead;
