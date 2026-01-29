const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const StudentCourse = sequelize.define(
    "StudentCourse",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        // =========================
        // General Settings
        // =========================
        courseName: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: "Name of the course",
        },

        duration: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: "Duration value (e.g. 30)",
        },

        durationType: {
            type: DataTypes.ENUM("Minutes", "Hours"),
            allowNull: false,
            comment: "Duration unit",
        },

        level: {
            type: DataTypes.ENUM("Beginner", "Intermediate", "Advanced"),
            allowNull: false,
            comment: "Course level",
        },

        coverImage: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: "Course cover image path",
        },
        sortOrder: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.ENUM("Pending", "Complete"),
            allowNull: false,
            defaultValue: "Pending",
            comment: "Course approval status",
        },

        // =========================
        // Course Videos (Multiple)
        // =========================
        videos: {
            type: DataTypes.JSON,
            allowNull: false,
            comment: `
            Course videos list
            Example:
            [
              {
                "name": "Introduction",
                "videoUrl": "/uploads/video1.mp4",
                "childFeatures": []
              },
              {
                "name": "Warm up",
                "videoUrl": "/uploads/video2.mp4",
                "childFeatures": []
              }
            ]
            `,
        },

        // =========================
        // Audit Fields
        // =========================
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

        deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        tableName: "student_courses",
        timestamps: true,
        paranoid: true,

    }
);

module.exports = StudentCourse;
