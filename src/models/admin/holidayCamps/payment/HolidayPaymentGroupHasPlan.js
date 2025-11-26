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

    // ✅ Foreign key to HolidayPaymentPlan
    payment_plan_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "payment_plans",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // ✅ Foreign key to HolidayPaymentGroup
    payment_group_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "holiday_payment_groups",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // ✅ Foreign key to admins table for creation
    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    tableName: "payment_group_has_plans",
    timestamps: true,
    paranoid: true, // ✅ Enable soft deletes
  }
);

module.exports = HolidayPaymentGroupHasPlan;
