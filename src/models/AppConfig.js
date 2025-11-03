// models/AppConfig.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

/**
 * AppConfig model
 * ---------------
 * - Stores environment-like configuration as key/value pairs.
 * - Sensitive values (like DB_PASSWORD, API_KEY) are encrypted automatically.
 */
const AppConfig = sequelize.define(
    "AppConfig",
    {
        id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true,
        },

        // e.g. "DB_HOST", "JWT_SECRET"
        key: {
            type: DataTypes.STRING(191),
            allowNull: false,
            unique: true,
        },

        // The stored value (plain text)
        value: {
            type: DataTypes.TEXT("long"),
            allowNull: true,
        },
        // Optional description for documentation
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },

        // Marks whether the key is sensitive (helps in filtering logs)
        isSensitive: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    },
    {
        tableName: "app_config",
        timestamps: true,
    }
);

module.exports = AppConfig;
