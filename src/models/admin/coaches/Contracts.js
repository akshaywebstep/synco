const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const ContractTemplate = sequelize.define(
    "ContractTemplate",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        // -------------------------
        // Basic Info
        // -------------------------
        title: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: "Contract template title (e.g. Head Coach Contract)",
        },

        contractType: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: "Type of contract (Head Coach, Venue Manager, Coaching, etc.)",
        },

        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: "Optional description of the contract",
        },

        // -------------------------
        // PDF Upload
        // -------------------------
        pdfFile: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: "Uploaded PDF contract file path",
        },

        // -------------------------
        // Tagging Configuration
        // -------------------------
        tags: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: `
            List of tagged fields inside PDF.
            Example:
            [
              {
                type: "S", // Samba Soccer Schools
                label: "Company Name",
                value: "Samba Soccer Schools",
                page: 1,
                x: 120,
                y: 450
              },
              {
                type: "C", // Coach
                label: "Coach Signature",
                fieldType: "signature",
                page: 3,
                x: 200,
                y: 700
              }
            ]
            `,
        },

        // -------------------------
        // Audit Fields
        // -------------------------
        createdBy: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "admins",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
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
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
        },
    },
    {
        tableName: "contract_templates",
        timestamps: true,
        paranoid: true,
    }
);

module.exports = ContractTemplate;
