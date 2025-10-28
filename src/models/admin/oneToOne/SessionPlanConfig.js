const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const SessionPlanConfig = sequelize.define(
    "SessionPlanConfig",
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },

        // Foreign key reference to SessionPlanGroup
        sessionPlanGroupId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: "session_plan_groups", // table name of SessionPlanGroup
                key: "id",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },

        // Type of session plan: one-to-one, birthday, etc.
        type: {
            type: DataTypes.ENUM("one_to_one", "birthday", "library"),
            allowNull: false,
        },

        // Foreign key reference to Admins
        createdBy: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true, // ✅ must be true for SET NULL
            references: {
                model: "admins",
                key: "id",
            },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
        },

        // For one-to-one
        pinned: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    },
    {
        tableName: "session_plan_configs",
        timestamps: true,
    }
);

// ✅ Define association with Admin
SessionPlanConfig.associate = (models) => {
    SessionPlanConfig.belongsTo(models.Admin, {
        foreignKey: "createdBy",
        as: "creator",
    });
};

module.exports = SessionPlanConfig;
