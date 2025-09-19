const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Credit = sequelize.define(
  "Credit",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    // ✅ FK → Booking.id
    bookingId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "booking",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Associated booking if credit is due to cancellation",
    },

    // ✅ Credit amount (in units)
    creditAmount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: "Number of credits issued",
    },

    // ✅ Reason: auto (system cancellation) or manual (admin override)
    reason: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "auto",
      comment: "Indicates whether credit was auto-issued or manually added",
    },
  },
  {
    tableName: "credits",
    timestamps: true,
  }
);

module.exports = Credit;
Credit.associate = (models) => {
  Credit.belongsTo(models.Booking, {
    foreignKey: "bookingId",
    as: "booking",
  });

  // Credit.belongsTo(models.ClassSchedule, {
  //   foreignKey: "classScheduleId",
  //   as: "classSchedule",
  // });
};
