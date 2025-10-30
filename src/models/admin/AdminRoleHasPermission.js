const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const AdminRoleHasPermission = sequelize.define(
  "AdminRoleHasPermission",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    roleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admin_roles",
        key: "id",
      },
    },
    permissionId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admin_permissions",
        key: "id",
      },
    },
  },
  {
    tableName: "admin_role_has_permissions",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["roleId", "permissionId"],
      },
    ],
  }
);

AdminRoleHasPermission.associate = (models) => {
  AdminRoleHasPermission.belongsTo(models.AdminRole, {
    foreignKey: "roleId",
    as: "role",
  });

  AdminRoleHasPermission.belongsTo(models.AdminRolePermission, {
    foreignKey: "permissionId",
    as: "permission",
  });
};

module.exports = AdminRoleHasPermission;
