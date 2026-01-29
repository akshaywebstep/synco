const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Referral = sequelize.define(
    "Referral",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        // Referrer (Admin who shared the link)
        referredBy: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: "admins", // table name
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
            comment: "Admin ID who referred this user",
        },

        firstName: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },

        lastName: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },

        email: {
            type: DataTypes.STRING(150),
            allowNull: false,
            validate: { isEmail: true },
        },

        phone: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },

        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
        },

        status: {
            type: DataTypes.ENUM("pending", "rewarded", "cancelled"),
            allowNull: false,
            defaultValue: "pending",
        },
    },
    {
        tableName: "referrals",
        timestamps: true,
    }
);

module.exports = Referral;
