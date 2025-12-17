const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Course = sequelize.define(
    "Course",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        // Step 1: Title & Description
        title: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: "Course title",
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: "Course description",
        },

        // Step 2: Modules 
        modules: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: "Array of modules with title and media",
        },

        // Step 3: Assessment
        questions: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: "Multiple-choice questions with answers",
        },

        // Step 4: Settings
        duration: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: "Duration of the course in minutes",
        },
        reTakeCourse: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: "How many times user can retake course",
        },
        passingConditionValue: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: "Minimum passing score percentage",
        },
        isCompulsory: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: "Is course compulsory",
        },
        setReminderEvery: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: "Reminder will start once user has completed course.",
        },

        // Step 5: Certificate
        certificateTitle: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "Title of the certificate",
        },
        uploadCertificate: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: "Certificate template file path",
        },

        // Step 6: Notifications
        notifiedUsers: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: "List of user IDs to notify upon course completion",
        },
        status: {
            type: DataTypes.ENUM("draft", "publish"),
            allowNull: false,
            defaultValue: "publish",
            comment: "Course status (draft or publish)",
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

        deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
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
    },
    {
        tableName: "courses",
        timestamps: true,
        paranoid: true,
    }
);

module.exports = Course;
