// models/PaymentGroupHasPlan.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const PaymentGroupHasPlan = sequelize.define(
  "PaymentGroupHasPlan",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    payment_plan_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    payment_group_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
  },
  {
    tableName: "payment_group_has_plans",
    timestamps: true,
  }
);

module.exports = PaymentGroupHasPlan;
