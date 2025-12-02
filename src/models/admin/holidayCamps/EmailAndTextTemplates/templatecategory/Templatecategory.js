const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../../config/db");

const TemplateCategory = sequelize.define(
  "TemplateCategory",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    category: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "created_by",  // ✅ match DB column
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "deleted_at", // ✅ match DB column
    },
    deletedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      field: "deleted_by", // ✅ match DB column
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    tableName: "template_category",
    timestamps: true,
    createdAt: "created_at", // ✅ ensure correct column names
    updatedAt: "updated_at",
    deletedAt: "deleted_at",
    paranoid: true, // ✅ enables soft delete
  }
);

module.exports = TemplateCategory;
