const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const ContactUs = sequelize.define(
    "ContactUs",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        name: {
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

        message: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        tableName: "contactUs",
        timestamps: true,
    }
);

module.exports = ContactUs;
