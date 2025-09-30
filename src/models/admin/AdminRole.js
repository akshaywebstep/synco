const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const AdminRole = sequelize.define(
  "AdminRole",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
  },
  {
    tableName: "admin_roles",
    timestamps: true,
  }
);

AdminRole.associate = (models) => {
  AdminRole.hasMany(models.Admin, { foreignKey: "roleId", as: "admins" });

  // Link through join table
  AdminRole.belongsToMany(models.AdminRolePermission, {
    through: models.AdminRoleHasPermission,
    foreignKey: "roleId",
    otherKey: "permissionId",
    as: "permissions",
  });
};

module.exports = AdminRole;
