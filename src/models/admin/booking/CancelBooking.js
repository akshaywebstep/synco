const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CancelBooking = sequelize.define(
  "CancelBooking",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    bookingId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    bookingType: {
      // new column
      type: DataTypes.ENUM("free_trial", "membership", "waiting list"),
      allowNull: false,
      defaultValue: "free_trial",
    },
    cancelReason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cancellationType: {
      type: DataTypes.ENUM("immediate", "scheduled"),
      allowNull: true,
    },
    cancelDate: {
      type: DataTypes.DATE,
      allowNull: true, // Null means immediate cancellation
    },
    additionalNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    transferReasonClass: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    removedReason: {
      type: DataTypes.STRING(255), // ✅ short reason text
      allowNull: true,
    },
    removedNotes: {
      type: DataTypes.TEXT, // ✅ longer optional notes
      allowNull: true,
    },
    reasonForCancelling: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    noMembershipReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    noMembershipNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },

  {
    tableName: "cancel_booking",
    timestamps: true,
  }
);

module.exports = CancelBooking;
