const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayCampDates = sequelize.define(
  "HolidayCampDates",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    endDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    totalDays: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },

    // Store sessions in one JSON field
    sessionsMap: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    // Foreign key to holiday_term_groups
    holidayCampId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "holiday_camp", // 🔥 UPDATED FK
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    // Foreign key to admins table for creation
    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },

    // Soft delete column
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // Foreign key to admins table for deletion
    deletedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    tableName: "holiday_camp_dates", // 🔥 NEW TABLE NAME
    timestamps: true,
    paranoid: true, // Enable soft deletes
  }
);

module.exports = HolidayCampDates;
