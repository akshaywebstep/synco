const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const ActivityLog = sequelize.define(
  "ActivityLog",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

    adminId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
    },

    panel: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "e.g., admin, user, vendor, etc.",
    },

    module: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "Module name like 'users', 'properties', etc.",
    },

    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "Action performed like 'create', 'update', 'delete', etc.",
    },

    data: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "Payload: created/updated/deleted data",
    },

    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      comment: "true for success, false for failure",
    },

    method: { type: DataTypes.STRING(10), allowNull: false },
    route: { type: DataTypes.STRING(255), allowNull: false },
    ip: { type: DataTypes.STRING(100), allowNull: false },
    userAgent: { type: DataTypes.TEXT, allowNull: false },

    location: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "Location info: latitude, longitude, city, region, country, timezone",
    },
    ispInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "ISP info: isp, organization, as, proxy",
    },
    deviceInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "Device info: device_type, browser_name, os",
    },
  },
  {
    tableName: "activity_logs",
    timestamps: true,
    updatedAt: false,
  }
);

// 👇 Define association here
ActivityLog.associate = (models) => {
  ActivityLog.belongsTo(models.Admin, {
    foreignKey: "adminId",
    as: "admin",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};

module.exports = ActivityLog;
