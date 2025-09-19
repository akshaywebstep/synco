// models/location/State.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const State = sequelize.define("State", {
    id: {
        type: DataTypes.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
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
    },
    iso2: {
        type: DataTypes.STRING,
        allowNull: true
    },
    type: {
        type: DataTypes.STRING(191),
        allowNull: true
    }
}, {
    tableName: "states",
    timestamps: true
});

State.associate = (models) => {
  State.belongsTo(models.Country, { foreignKey: "countryId", as: "country" });
  State.hasMany(models.City, { foreignKey: "stateId", as: "cities" });
  State.hasMany(models.Admin, { foreignKey: "stateId", as: "admins" });
};

module.exports = State;
