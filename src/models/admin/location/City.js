// models/location/City.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const City = sequelize.define("City", {
    id: {
        type: DataTypes.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    stateId: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false
    },
    stateCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    countryId: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false
    },
    countryCode: {
        type: DataTypes.CHAR(2),
        allowNull: false
    }
}, {
    tableName: "cities",
    timestamps: true
});

City.associate = (models) => {
  City.belongsTo(models.Country, { foreignKey: "countryId", as: "country" });
  City.belongsTo(models.State, { foreignKey: "stateId", as: "state" });
  City.hasMany(models.Admin, { foreignKey: "cityId", as: "admins" });
};

module.exports = City;
