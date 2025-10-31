const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const OneToOneEmergency = sequelize.define(
  "OneToOneEmergency",
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
        model: "one_to_one_students",
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
    tableName: "one_to_one_emergency",
    timestamps: true,
  }
);

module.exports = OneToOneEmergency;
