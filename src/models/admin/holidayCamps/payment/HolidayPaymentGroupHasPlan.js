// models/HolidayPaymentGroupHasPlan.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayPaymentGroupHasPlan = sequelize.define(
  "HolidayPaymentGroupHasPlan",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    payment_plan_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "holiday_payment_plans", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    payment_group_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "holiday_payment_groups", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "admins", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    deletedAt: { type: DataTypes.DATE, allowNull: true },

    deletedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "admins", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    tableName: "holiday_has_plans",
    timestamps: true,
    paranoid: true,

  }
);

module.exports = HolidayPaymentGroupHasPlan;
