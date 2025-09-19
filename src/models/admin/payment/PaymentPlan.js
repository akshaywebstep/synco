const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const PaymentPlan = sequelize.define(
  "PaymentPlan",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
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
    priceLesson: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    interval: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    duration: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    students: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    joiningFee: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    HolidayCampPackage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    termsAndCondition: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "payment_plans",
    timestamps: true,
  }
);

// ✅ Association
PaymentPlan.associate = (models) => {
  PaymentPlan.belongsToMany(models.PaymentGroup, {
    through: models.PaymentGroupHasPlan,
    foreignKey: "payment_plan_id",
    otherKey: "payment_group_id",
    as: "paymentGroups",
  });
};

module.exports = PaymentPlan;
