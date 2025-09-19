const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const TermGroup = sequelize.define(
  "TermGroup",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "term_groups",
    timestamps: true,
  }
);

module.exports = TermGroup;
