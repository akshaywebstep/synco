const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");
const Booking = require("./Booking");

const FreezeBooking = sequelize.define(
  "FreezeBooking",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    bookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: Booking, // ✅ foreign key reference
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    freezeStartDate: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    freezeDurationMonths: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    reactivateOn: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    reasonForFreezing: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "freeze_booking",
    timestamps: true,
  }
);

// ✅ Associations
FreezeBooking.associate = (models) => {
  FreezeBooking.belongsTo(models.Booking, {
    foreignKey: "bookingId",
    as: "booking",
  });
};

module.exports = FreezeBooking;
