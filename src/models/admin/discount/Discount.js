const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Discount = sequelize.define(
  "Discount",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      comment: "Primary key: auto-incrementing ID",
    },
    type: {
      type: DataTypes.ENUM("code", "automatic"),
      allowNull: false,
      defaultValue: "code",
      comment: "Type of discount: code (manual) or automatic",
    },
    code: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "Discount code if applicable (null for automatic)",
    },
    valueType: {
      type: DataTypes.ENUM("percentage", "fixed"),
      allowNull: false,
      field: "value_type",
      comment: "Type of discount value: percentage or fixed amount",
    },
    value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: "Numeric value of the discount (e.g. 10%, $5)",
    },
    applyOncePerOrder: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "apply_once_per_order",
      comment: "Whether to apply discount only once per order",
    },
    limitTotalUses: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      field: "limit_total_uses",
      comment: "Total times this discount can be used (null = unlimited)",
    },
    limitPerCustomer: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      field: "limit_per_customer",
      comment: "Limit of usage per customer (null = unlimited)",
    },
    startDatetime: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "start_datetime",
      comment: "Start date and time when the discount becomes active",
    },
    endDatetime: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "end_datetime",
      comment: "End date and time when the discount expires (null = no expiry)",
    },
  },
  {
    tableName: "discounts",
    timestamps: true,
    comment: "Stores discount codes and their configurations",
  }
);

// ✅ Associations
Discount.associate = (models) => {
  Discount.hasMany(models.DiscountUsage, {
    foreignKey: "discountId",
    as: "usages",
    onDelete: "CASCADE",
  });

  Discount.hasMany(models.DiscountAppliesTo, {
    foreignKey: "discountId",
    as: "appliesTo",
    onDelete: "CASCADE",
  });
};

module.exports = Discount;
