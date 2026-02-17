const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayBookingEmergencyMeta = sequelize.define(
  "HolidayBookingEmergencyMeta",
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
        model: "holiday_booking_student_meta",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    emergencyFirstName: DataTypes.STRING,
    emergencyLastName: DataTypes.STRING,
    emergencyPhoneNumber: DataTypes.STRING,
    emergencyRelation: DataTypes.STRING,
  },
  {
    tableName: "holiday_booking_emergency_meta",
    timestamps: true,
  }
);

module.exports = HolidayBookingEmergencyMeta;
