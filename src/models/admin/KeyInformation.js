const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

const KeyInformation = sequelize.define(
  "KeyInformation", 
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    serviceType: {
      type: DataTypes.ENUM(
        "trial",
        "membership",
        "waiting_list",
        "holiday_camp",
        "birthday_party",
        "one_to_one"
      ),
      allowNull: false,
      unique: true,
    },

    keyInformation: {
      type: DataTypes.JSON,
      allowNull: false,
      // example:
      // [
      //   "Arrive 10 mins early",
      //   "Bring water",
      //   "Call if running late"
      // ]
    },
  },
  {
    tableName: "key_information", // ✅ actual table name
    timestamps: true,
  }
);

module.exports = KeyInformation;
