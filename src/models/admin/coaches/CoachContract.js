const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CoachContract = sequelize.define(
  "CoachContract",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // -------------------------
    // Coach
    // -------------------------
    coachId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // -------------------------
    // Contract Template
    // -------------------------
    contractTemplateId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "contract_templates",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // -------------------------
    // Contract Status
    // -------------------------
    status: {
      type: DataTypes.ENUM("pending", "signed"),
      defaultValue: "pending",
      comment: "Contract signing status",
    },

    // -------------------------
    // Signed Time
    // -------------------------
    signedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Date when coach accepted/signed contract",
    },

    // -------------------------
    // Soft Delete Fields
    // -------------------------
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
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Admin who deleted this record",
    },
  },
  {
    tableName: "coach_contracts",
    timestamps: true,
    paranoid: true,
  }
);

module.exports = CoachContract;