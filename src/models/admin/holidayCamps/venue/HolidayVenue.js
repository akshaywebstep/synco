const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayVenue = sequelize.define(
    "HolidayVenue",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
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
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: "holiday_payment_groups", // 👈 your table name
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
        holidayCampId: {
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
            type: DataTypes.BIGINT.UNSIGNED,
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
        tableName: "holiday_venues",
        timestamps: true,
        paranoid: true, // ✅ Enable soft deletes
    }
);

// Associations
// Associations
HolidayVenue.associate = function (models) {
    HolidayVenue.hasMany(models.HolidayClassSchedule, {
        foreignKey: "venueId",
        as: "holidayClassSchedules",
    });
};

module.exports = HolidayVenue;
