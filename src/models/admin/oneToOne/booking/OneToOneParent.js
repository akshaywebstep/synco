const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const OneToOneParent = sequelize.define(
  "OneToOneParent",
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
    tableName: "one_to_one_parent",
    timestamps: true,
  }
);

module.exports = OneToOneParent;
