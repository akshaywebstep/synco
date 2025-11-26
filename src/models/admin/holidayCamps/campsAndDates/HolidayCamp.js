const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayCamp = sequelize.define(
  "HolidayCamp",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    // Foreign key to admins table for creation
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

    // Soft delete column
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // Foreign key to admins table for deletion
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
    tableName: "holiday_camp", // 🔥 NEW TABLE NAME
    timestamps: true,
    paranoid: true, // soft delete enabled
  }
);

module.exports = HolidayCamp;
