const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../../config/db");

const CustomTemplate = sequelize.define(
  "CustomTemplate",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    mode_of_communication: {
      type: DataTypes.ENUM("email", "text"),
      allowNull: false,
    },

    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    template_category_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "template_category", // ✅ FIXED HERE
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },

    tags: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    sender_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    content: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },

    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    deletedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
  },
  {
    tableName: "custom_template",
    timestamps: true,
    paranoid: true,
  }
);

module.exports = CustomTemplate;
