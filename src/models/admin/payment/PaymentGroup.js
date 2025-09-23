// models/PaymentGroup.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const PaymentGroup = sequelize.define(
  "PaymentGroup",
  {
    id: {
  type: DataTypes.INTEGER.UNSIGNED,
  autoIncrement: true,
  primaryKey: true,
},

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: DataTypes.TEXT,
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },

  {
    tableName: "payment_groups",
    timestamps: true,
  }
);

// ✅ Association
PaymentGroup.associate = (models) => {
  PaymentGroup.belongsToMany(models.PaymentPlan, {
    through: models.PaymentGroupHasPlan,
    foreignKey: "payment_group_id",
    otherKey: "payment_plan_id",
    as: "paymentPlans",
  });
};

module.exports = PaymentGroup;
