// // models/PaymentGroupHasPlan.js

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
      references: {
        model: "payment_plans",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    payment_group_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "payment_groups",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // ✅ Foreign key to admins table for creation
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    // ✅ Soft delete column
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // ✅ Foreign key to admins table for deletion
    deletedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
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

module.exports = PaymentGroupHasPlan;

// const { DataTypes } = require("sequelize");
// const { sequelize } = require("../../../config/db");

// const PaymentGroupHasPlan = sequelize.define(
//   "PaymentGroupHasPlan",
//   {
//     id: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       autoIncrement: true,
//       primaryKey: true,
//     },
//     payment_plan_id: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       allowNull: false,
//     },
//     payment_group_id: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       allowNull: false,
//     },
//     createdBy: {
//       type: DataTypes.INTEGER.UNSIGNED,
//       allowNull: true,
//     },
//   },
//   {
//     tableName: "payment_group_has_plans",
//     timestamps: true,
//   }
// );

// module.exports = PaymentGroupHasPlan;
