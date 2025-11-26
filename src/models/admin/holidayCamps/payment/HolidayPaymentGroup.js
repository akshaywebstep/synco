// models/HolidayPaymentGroup.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayPaymentGroup = sequelize.define(
  "HolidayPaymentGroup",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // ✅ Foreign key to admins table for creation
    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },

    // ✅ Soft delete column (paranoid)
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
  },
  {
    tableName: "holiday_payment_groups",
    timestamps: true,
    paranoid: true, // ✅ Enables soft deletes
  }
);

// ✅ Associations
HolidayPaymentGroup.associate = (models) => {
  HolidayPaymentGroup.belongsToMany(models.HolidayPaymentPlan, {
    through: models.HolidayPaymentGroupHasPlan,
    foreignKey: "payment_group_id",
    otherKey: "payment_plan_id",
    as: "holidayPaymentPlans",
  });
};

module.exports = HolidayPaymentGroup;
