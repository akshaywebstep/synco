const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Comment = sequelize.define(
    "Comment",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        // ✅ Foreign key → admins.id (nullable if admin deleted)
        commentBy: {
            type: DataTypes.BIGINT.UNSIGNED,
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
            type: DataTypes.ENUM("free", "paid", "waiting list","lead"),
            allowNull: false,
            defaultValue: "free",
            comment: "Type of comment (free, paid, waiting list)",
        },

        serviceType: {
            type: DataTypes.ENUM("weekly class", "birthday party", "one to one","holiday camp"),
            allowNull: true,
            defaultValue: "free",
            comment: "Type of comment (weekly class, birthday party,holiday camp)",
        },
    },
    {
        tableName: "comments",
        timestamps: true, // Sequelize will auto-generate createdAt & updatedAt
    }

);

module.exports = Comment;
