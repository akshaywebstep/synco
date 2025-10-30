const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const AdminRolePermission = sequelize.define(
  "AdminRolePermission",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    module: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "admin_permissions",
    timestamps: true,
  }
);

AdminRolePermission.associate = (models) => {
  AdminRolePermission.belongsToMany(models.AdminRole, {
    through: models.AdminRoleHasPermission,
    foreignKey: "permissionId",
    otherKey: "roleId",
    as: "roles",
  });
};

module.exports = AdminRolePermission;
