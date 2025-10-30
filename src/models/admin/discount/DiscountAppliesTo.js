const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");
const Discount = require("./Discount"); // Adjust path if needed

const DiscountAppliesTo = sequelize.define(
    "DiscountAppliesTo",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
            comment: "Primary key"
        },
        discountId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            field: "discount_id",
            comment: "Foreign key to discounts table",
            references: {
                model: Discount,
                key: "id"
            },
            onDelete: "CASCADE"
        },
        target: {
            type: DataTypes.ENUM(
                'joining_fee',
                'per_rate_lessons',
                'uniform_fee',
                'one_to_one',
                'holiday_camp',
                'birthday_party'
            ),
            allowNull: false,
            comment: "Area of application for the discount"
        }
    },
    {
        tableName: "discount_applies_to",
        timestamps: false,
        comment: "Mapping of discounts to specific services they apply to"
    }
);

// ✅ Association
DiscountAppliesTo.associate = (models) => {
  DiscountAppliesTo.belongsTo(models.Discount, {
    foreignKey: "discountId",
    as: "discount",
    onDelete: "CASCADE"
  });
};

module.exports = DiscountAppliesTo;
