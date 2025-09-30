const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const RebookingTrial = sequelize.define(
  "RebookingTrial",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    bookingTrialId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: "booking",
        key: "id",
      },
      onDelete: "CASCADE",
      comment: "The original booking being rebooked",
    },
    reasonForNonAttendance: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Reason why the student did NOT attend",
    },

    additionalNote: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Optional internal admin note for this rebooking attempt",
    },
  },
  {
    tableName: "rebooking",
    timestamps: true,
  }
);

module.exports = RebookingTrial;
