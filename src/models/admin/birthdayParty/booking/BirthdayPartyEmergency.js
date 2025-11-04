const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const BirthdayPartyEmergency = sequelize.define(
  "BirthdayPartyEmergency",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    studentId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "birthday_party_students",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    emergencyFirstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    emergencyLastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    relationChild: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Relation with the child (e.g., Uncle, Aunt, Friend)",
    },
  },
  {
    tableName: "birthday_party_emergency",
    timestamps: true,
  }
);

module.exports = BirthdayPartyEmergency;
