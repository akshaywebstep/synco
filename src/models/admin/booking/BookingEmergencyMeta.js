const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const BookingEmergencyMeta = sequelize.define(
  "BookingEmergencyMeta",
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
        model: "booking_student_meta",
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
    tableName: "booking_emergency_meta",
    timestamps: true,
  }
);
// BookingEmergencyMeta.associate = (models) => {
//   BookingEmergencyMeta.belongsTo(models.BookingStudentMeta, {
//     foreignKey: "studentId",
//     as: "student",
//   });
// };

module.exports = BookingEmergencyMeta;
