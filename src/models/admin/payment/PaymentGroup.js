// // models/PaymentGroup.js

// models/PaymentGroup.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const PaymentGroup = sequelize.define(
  "PaymentGroup",
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

    description: DataTypes.TEXT,

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
      onDelete: "SET NULL", // nullify if admin is deleted
    },
  },

  {
    tableName: "payment_groups",
    timestamps: true,
    paranoid: true, // ✅ Enables soft deletes
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

// const { DataTypes } = require("sequelize");
// const { sequelize } = require("../../../config/db");

// const PaymentGroup = sequelize.define(
//   "PaymentGroup",
//   {
//     id: {
//   type: DataTypes.BIGINT.UNSIGNED,
//   autoIncrement: true,
//   primaryKey: true,
// },

//     name: {
//       type: DataTypes.STRING,
//       allowNull: false,
//     },
//     description: DataTypes.TEXT,
//     createdBy: {
//       type: DataTypes.BIGINT.UNSIGNED,
//       allowNull: false,
//     },
//   },

//   {
//     tableName: "payment_groups",
//     timestamps: true,
//   }
// );

// // ✅ Association
// PaymentGroup.associate = (models) => {
//   PaymentGroup.belongsToMany(models.PaymentPlan, {
//     through: models.PaymentGroupHasPlan,
//     foreignKey: "payment_group_id",
//     otherKey: "payment_plan_id",
//     as: "paymentPlans",
//   });
// };

// module.exports = PaymentGroup;
