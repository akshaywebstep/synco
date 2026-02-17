// models/HolidayPaymentPlan.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayPaymentPlan = sequelize.define(
  "HolidayPaymentPlan",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    price: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },

    // priceLesson: {
    //   type: DataTypes.FLOAT,
    //   allowNull: false,
    // },

    interval: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    duration: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    students: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    joiningFee: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },

    holidayCampPackage: { // use camelCase consistently
      type: DataTypes.TEXT,
      allowNull: true,
    },

    termsAndCondition: {
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
  },
  {
    tableName: "holiday_payment_plans",
    timestamps: true,
    paranoid: true, // ✅ Enables soft deletes
  }
);

// ✅ Associations
HolidayPaymentPlan.associate = (models) => {
  HolidayPaymentPlan.belongsToMany(models.HolidayPaymentGroup, {
    through: models.HolidayPaymentGroupHasPlan, // corrected join table name
    foreignKey: "payment_plan_id",
    otherKey: "payment_group_id",
    as: "holidayPaymentGroups",
  });
};

module.exports = HolidayPaymentPlan;
