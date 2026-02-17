const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayBookingParentMeta = sequelize.define(
  "HolidayBookingParentMeta",
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
    parentFirstName: DataTypes.STRING,
    parentLastName: DataTypes.STRING,
    parentEmail: DataTypes.STRING,
    parentPhoneNumber: DataTypes.STRING,
    relationToChild: DataTypes.STRING,
    howDidYouHear: DataTypes.STRING,
  },
  {
    tableName: "holiday_booking_parent_meta",
    timestamps: true,
  }
);

module.exports = HolidayBookingParentMeta;
