const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const BookingParentMeta = sequelize.define(
  "BookingParentMeta",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    studentId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "booking_student_meta",
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
    tableName: "booking_parent_meta", // 👈 custom table name
    timestamps: true,
  }
);
// BookingParentMeta.associate = (models) => {
//   BookingParentMeta.belongsTo(models.BookingStudentMeta, {
//     foreignKey: "studentId",
//     as: "student",
//   });
// };

module.exports = BookingParentMeta;
