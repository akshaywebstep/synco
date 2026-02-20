// models/StarterPack.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const StarterPack = sequelize.define(
    "StarterPack",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },

        title: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },

        price: {
            type: DataTypes.FLOAT,
            allowNull: false,
        },

        enabled: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        mandatory: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        appliesOnTrialConversion: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        appliesOnDirectMembership: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        paymentRouting: {
            type: DataTypes.ENUM("head_office", "franchise"),
            allowNull: false,
            defaultValue: "head_office",
            comment: "Defines where starter pack revenue goes",
        },

        createdBy: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true, // must be true if SET NULL
            references: {
                model: "admins",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
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


        deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        tableName: "starter_packs",
        timestamps: true,
        paranoid: true,
    }
);

module.exports = StarterPack;
