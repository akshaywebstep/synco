const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayClassSchedule = sequelize.define(
  "HolidayClassSchedule",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    className: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    capacity: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    totalCapacity: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    startTime: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    endTime: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    venueId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "holiday_venues", // ✅ Table name for Venue
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    holidayCampDateIds: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
      comment: "Selected term (stored as text instead of FK)",
    },

    // ✅ Foreign key to admins table for creation
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

    // ✅ Soft delete column
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // ✅ Foreign key to admins table for deletion
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
    status: {
      type: DataTypes.ENUM("active", "cancelled"),
      allowNull: false,
      defaultValue: "active",
    },
  },
  {
    tableName: "holiday_class_schedules",
    timestamps: true,
    paranoid: true, // ✅ Enable soft deletes
  }
);

// ✅ Add this association inside the model file
HolidayClassSchedule.associate = function (models) {
  HolidayClassSchedule.belongsTo(models.HolidayVenue, {
    foreignKey: "venueId",
    as: "venue",
  });

};

module.exports = HolidayClassSchedule;

