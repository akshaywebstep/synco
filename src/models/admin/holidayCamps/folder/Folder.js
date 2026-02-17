// models/Folder.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const Folder = sequelize.define(
  "Folder",
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
    // Created by admin
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

    // Soft delete timestamp
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // Deleted by admin
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
    tableName: "folders",
    timestamps: true,
    paranoid: true,
  }
);

module.exports = Folder;
