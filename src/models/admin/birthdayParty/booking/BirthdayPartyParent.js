const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const BirthdayPartyParent = sequelize.define(
  "BirthdayPartyParent",
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

    parentFirstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    parentLastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    parentEmail: {
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
      comment: "Relation with the child (e.g., Mother, Father, Guardian)",
    },

    howDidHear: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "How they heard about the program",
    },
  },
  {
    tableName: "birthday_party_parent",
    timestamps: true,
  }
);

module.exports = BirthdayPartyParent;
