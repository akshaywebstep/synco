const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const AdminDashboardWidget = sequelize.define(
  "AdminDashboardWidget",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    adminId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    order: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    visible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "admin_dashboard_widgets",
    timestamps: true,
  }
);

AdminDashboardWidget.associate = (models) => {
  AdminDashboardWidget.belongsTo(models.Admin, {
    foreignKey: "adminId",
    onDelete: "CASCADE",
  });
};

module.exports = AdminDashboardWidget;
