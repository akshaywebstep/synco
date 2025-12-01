const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayBookingStudentMeta = sequelize.define(
  "HolidayBookingStudentMeta",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    bookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "holiday_booking",
        key: "id",
      },
      onDelete: "CASCADE",
    },
     attendance: {
      type: DataTypes.ENUM("attended", "not attended"),
      allowNull: false,
      defaultValue: "not attended",
    },
    studentFirstName: DataTypes.STRING,
    studentLastName: DataTypes.STRING,
    dateOfBirth: DataTypes.DATEONLY,
    age: DataTypes.BIGINT.UNSIGNED,
    gender: DataTypes.STRING,
    medicalInformation: DataTypes.STRING,
  },
  {
    tableName: "holiday_booking_student_meta", 
    timestamps: true,
  }
);

HolidayBookingStudentMeta.associate = (models) => {
  HolidayBookingStudentMeta.belongsTo(models.HolidayBooking, {
    foreignKey: "bookingId",
    as: "holidayBooking",
  });

  HolidayBookingStudentMeta.hasMany(models.HolidayBookingParentMeta, {
    foreignKey: "studentId",
    as: "parents",
  });

  HolidayBookingStudentMeta.hasMany(models.HolidayBookingEmergencyMeta, {
    foreignKey: "studentId",
    as: "emergencyContacts",
  });
};



module.exports = HolidayBookingStudentMeta;
