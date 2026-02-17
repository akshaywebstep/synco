const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");
const Discount = require("./Discount"); // Adjust path if needed
const Admin = require("../../admin/Admin"); // Adjust path if needed

const DiscountUsage = sequelize.define(
    "DiscountUsage",
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
            comment: "Reference to discounts table",
            references: {
                model: Discount,
                key: "id"
            },
            onDelete: "CASCADE"
        },
        adminId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            field: "admin_id",
            comment: "Reference to admins table",
            references: {
                model: Admin,
                key: "id"
            },
            onDelete: "CASCADE"
        },
        usedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            field: "used_at",
            defaultValue: DataTypes.NOW,
            comment: "When the discount was used"
        }
    },
    {
        tableName: "discount_usages",
        timestamps: false,
        comment: "Tracks when a customer uses a discount"
    }
);

// ✅ Associations
DiscountUsage.associate = (models) => {
  DiscountUsage.belongsTo(models.Discount, {
    foreignKey: "discountId",
    as: "discount",
    onDelete: "CASCADE"
  });

  DiscountUsage.belongsTo(models.Admin, {
    foreignKey: "adminId",
    as: "admin",
    onDelete: "CASCADE"
  });
};

module.exports = DiscountUsage;
