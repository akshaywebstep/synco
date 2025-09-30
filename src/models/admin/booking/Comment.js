const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Comment = sequelize.define(
    "Comment",
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        // ✅ Foreign key → admins.id (nullable if admin deleted)
        commentBy: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: "admins", // table name
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
            comment: "Admin who made the comment (nullable if deleted)",
        },

        // ✅ Comment text
        comment: {
            type: DataTypes.TEXT,
            allowNull: false,
            comment: "The text content of the comment",
        },

        // ✅ Comment type (ENUM)
        commentType: {
            type: DataTypes.ENUM("free", "paid", "waiting list"),
            allowNull: false,
            defaultValue: "free",
            comment: "Type of comment (free, paid, waiting list)",
        },
    },
    {
        tableName: "comments",
        timestamps: true, // Sequelize will auto-generate createdAt & updatedAt
    }

);

module.exports = Comment;
