
const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Venue = sequelize.define(
  "Venue",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    area: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    facility: {
      type: DataTypes.ENUM("Indoor", "Outdoor"),
      allowNull: false,
    },
    parkingNote: {
      type: DataTypes.TEXT,
    },
    howToEnterFacility: {
      type: DataTypes.TEXT,
    },

    // ✅ plain text only (no FK)
    // paymentGroupId: {
    //   type: DataTypes.TEXT("long"),
    //   allowNull: true,
    //   comment: "Selected payment group for paid bookings (stored as text instead of FK)",
    // },
    // ✅ Use FK to PaymentGroups
    paymentGroupId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "payment_groups", // 👈 your table name
        key: "id",
      },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },

    isCongested: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    hasParking: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    // ✅ plain text only (no FK)
    termGroupId: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
      comment: "Selected term group for paid bookings (stored as text instead of FK)",
    },

    latitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    longitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    postal_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // ✅ Foreign key to admins table for creation
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      // onDelete: "RESTRICT",
      onDelete: "SET NULL",
    },

    // ✅ Soft delete column
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // ✅ Foreign key to admins table for deletion
    deletedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
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
    tableName: "venues",
    timestamps: true,
    paranoid: true, // ✅ Enable soft deletes
  }
);

// Associations
Venue.associate = function (models) {
  Venue.hasMany(models.ClassSchedule, {
    foreignKey: "venueId",
    as: "classSchedules",
  });
};

module.exports = Venue;
