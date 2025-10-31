const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const OneToOneStudent = sequelize.define(
  "OneToOneStudent",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    oneToOneBookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "one_to_one_bookings",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      comment: "Reference to one-to-one booking",
    },

    studentFirstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    studentLastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },

    age: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },

    gender: {
      type: DataTypes.ENUM("male", "female", "other"),
      allowNull: true,
    },

    medicalInfo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "one_to_one_students",
    timestamps: true,
  }
);

OneToOneStudent.associate = (models) => {
  OneToOneStudent.hasOne(models.OneToOneParent, {
    foreignKey: "studentId",
    as: "parentDetails",
  });

  OneToOneStudent.hasOne(models.OneToOneEmergency, {
    foreignKey: "studentId",
    as: "emergencyDetails",
  });
};

module.exports = OneToOneStudent;
