const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const BirthdayPartyStudent = sequelize.define(
  "BirthdayPartyStudent",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    birthdayPartyBookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "birthday_party_bookings",
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
    tableName: "birthday_party_students",
    timestamps: true,
  }
);

BirthdayPartyStudent.associate = (models) => {
  BirthdayPartyStudent.hasMany(models.BirthdayPartyParent, {
    foreignKey: "studentId",
    as: "parentDetails",
  });

  BirthdayPartyStudent.hasOne(models.BirthdayPartyEmergency, {
    foreignKey: "studentId",
    as: "emergencyDetails",
  });

  BirthdayPartyStudent.belongsTo(models.BirthdayPartyBooking, {
    foreignKey: "birthdayPartyBookingId", // must match the FK used in hasMany
    as: "booking", // can be "booking" (common), OR whatever you use in other includes
  });
};

module.exports = BirthdayPartyStudent;
