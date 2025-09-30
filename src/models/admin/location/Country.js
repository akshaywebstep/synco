// models/location/Country.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Country = sequelize.define("Country", {
    id: {
        type: DataTypes.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    iso3: {
        type: DataTypes.CHAR(3),
        allowNull: true
    },
    iso2: {
        type: DataTypes.CHAR(2),
        allowNull: true
    },
    phonecode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    capital: {
        type: DataTypes.STRING,
        allowNull: true
    },
    currency: {
        type: DataTypes.STRING,
        allowNull: true
    },
    currencyName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    currencySymbol: {
        type: DataTypes.STRING,
        allowNull: true
    },
    native: {
        type: DataTypes.STRING,
        allowNull: true
    },
    nationality: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: "countries",
    timestamps: true
});

Country.associate = (models) => {
  Country.hasMany(models.State, { foreignKey: "countryId", as: "states" });
  Country.hasMany(models.City, { foreignKey: "countryId", as: "cities" });
  Country.hasMany(models.Admin, { foreignKey: "countryId", as: "admins" });
};

module.exports = Country;
