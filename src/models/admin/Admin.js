const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const Admin = sequelize.define(
  "Admin",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    profile: { type: DataTypes.STRING, allowNull: true },
    firstName: { type: DataTypes.STRING(100), allowNull: false },
    lastName: { type: DataTypes.STRING(100), allowNull: true },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    password: { type: DataTypes.STRING(255), allowNull: false },
    passwordHint: { type: DataTypes.STRING, allowNull: true },
    position: { type: DataTypes.STRING, allowNull: true },
    phoneNumber: { type: DataTypes.STRING, allowNull: true },
    roleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      references: { model: "admin_roles", key: "id" },
    },
    countryId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "countries", key: "id" },
      field: "country_id",
    },
    stateId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "states", key: "id" },
      field: "state_id",
    },
    cityId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "cities", key: "id" },
      field: "city_id",
    },
    city: { type: DataTypes.STRING(100), allowNull: true },

    postalCode: { type: DataTypes.STRING(20), allowNull: true },

    resetOtp: { type: DataTypes.STRING(10), allowNull: true },
    resetOtpExpiry: { type: DataTypes.DATE, allowNull: true },

    // 🔽 ADD THESE
    resetToken: { type: DataTypes.STRING(255), allowNull: true },
    resetTokenExpiry: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM("active", "inactive", "suspend"),
      defaultValue: "active",
    },
    qualifications: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
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

    // 🔹 Self-referencing foreign keys
    createdByAdmin: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
      references: { model: "admins", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    superAdminId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
      references: { model: "admins", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    tableName: "admins",
    timestamps: true,
    paranoid: true, // ✅ Enable soft deletes
  }
);

Admin.associate = (models) => {
  // Association to AdminRole
  Admin.belongsTo(models.AdminRole, {
    foreignKey: "roleId",
    as: "role",
  });

  // Self-referencing associations
  Admin.belongsTo(models.Admin, {
    foreignKey: "createdByAdmin",
    as: "creatorAdmin",
  });
  Admin.belongsTo(models.Admin, {
    foreignKey: "superAdminId",
    as: "superAdminCreator",
  });

  Admin.hasMany(models.ActivityLog, {
    foreignKey: "adminId",
    as: "activityLogs",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  Admin.hasMany(models.CustomNotification, {
    foreignKey: "adminId",
    as: "customNotifications",
    onDelete: "CASCADE",
  });

  Admin.hasMany(models.CustomNotificationRead, {
    foreignKey: "adminId",
    as: "customNotificationReads",
    onDelete: "SET NULL",
  });

  Admin.belongsTo(models.Country, {
    foreignKey: "countryId",
    as: "country",
  });

  Admin.belongsTo(models.State, {
    foreignKey: "stateId",
    as: "state",
  });

  Admin.belongsTo(models.City, {
    foreignKey: "cityId",
    as: "cityDetails",
  });

  Admin.hasMany(models.DiscountUsage, {
    foreignKey: "adminId",
    as: "discountUsages",
    onDelete: "CASCADE",
  });

  Admin.hasMany(models.Notification, {
    foreignKey: "adminId",
    as: "notifications",
    onDelete: "CASCADE",
  });

  Admin.hasMany(models.NotificationRead, {
    foreignKey: "adminId",
    as: "notificationReads",
    onDelete: "SET NULL",
  });
};

module.exports = Admin;
