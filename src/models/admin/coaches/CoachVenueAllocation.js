const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const CoachVenueAllocation = sequelize.define(
    "CoachVenueAllocation",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        venueId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "venues",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
        },
        coachId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "admins",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
        },

        rate: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "rate",
        },

        createdBy: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "admins",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
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
        tableName: "coach_venue_alloaction",
        timestamps: true,
        underscored: false,
        paranoid: true,
    }
);

module.exports = CoachVenueAllocation;
