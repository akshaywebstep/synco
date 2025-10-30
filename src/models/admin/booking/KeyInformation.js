const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const KeyInformation = sequelize.define(
  "KeyInformation", // ✅ Model name should match export
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // keyInformation: {
    //   type: DataTypes.STRING,
    //   allowNull: false, 
    // },
     keyInformation: {
      type: DataTypes.TEXT, // ✅ Changed from STRING to TEXT
      allowNull: false,
    },
  },
  {
    tableName: "key_information", // ✅ actual table name
    timestamps: true,
  }
);

module.exports = KeyInformation;
