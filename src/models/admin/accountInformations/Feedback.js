const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Feedback = sequelize.define(
  "Feedback",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    // FK → bookings.id
    bookingId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "bookings",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // FK → class_schedules.id
    classScheduleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "class_schedules",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    // FK → venues.id
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

    feedbackType: {
      type: DataTypes.ENUM("positive", "negative"),
      allowNull: false,
    },

    category: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // FK → admins.id
    agentAssigned: {
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
      type: DataTypes.ENUM("in_process", "resolved"),
      allowNull: false,
      defaultValue: "in_process",
    },

    // FK → admins.id
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
    tableName: "feedback",
    timestamps: true,
    paranoid: true,
    // underscored: true,
  }
);

module.exports = Feedback;

// CREATE TABLE `feedback` (
//   `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
//   `title` VARCHAR(255) NOT NULL,

//   `booking_id` BIGINT UNSIGNED NOT NULL,
//   `class_schedule_id` BIGINT UNSIGNED NOT NULL,
//   `venue_id` BIGINT UNSIGNED NOT NULL,

//   `feedback_type` ENUM('positive','negative') NOT NULL,
//   `category` VARCHAR(100) NOT NULL,
//   `reason` TEXT NULL,

//   `agent_assigned` BIGINT UNSIGNED NULL,
//   `status` ENUM('in_process','resolved') NOT NULL DEFAULT 'in_process',

//   `created_by` BIGINT UNSIGNED NOT NULL,

//   `created_at` DATETIME NOT NULL,
//   `updated_at` DATETIME NOT NULL,
//   `deleted_at` DATETIME NULL,
//   `deleted_by` BIGINT UNSIGNED NULL,

//   PRIMARY KEY (`id`),

//   CONSTRAINT `fk_feedback_booking`
//     FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
//     ON UPDATE CASCADE ON DELETE CASCADE,

//   CONSTRAINT `fk_feedback_class_schedule`
//     FOREIGN KEY (`class_schedule_id`) REFERENCES `class_schedules`(`id`)
//     ON UPDATE CASCADE ON DELETE CASCADE,

//   CONSTRAINT `fk_feedback_venue`
//     FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`)
//     ON UPDATE CASCADE ON DELETE CASCADE,

//   CONSTRAINT `fk_feedback_agent`
//     FOREIGN KEY (`agent_assigned`) REFERENCES `admins`(`id`)
//     ON UPDATE CASCADE ON DELETE SET NULL,

//   CONSTRAINT `fk_feedback_created_by`
//     FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`)
//     ON UPDATE CASCADE ON DELETE RESTRICT,

//   CONSTRAINT `fk_feedback_deleted_by`
//     FOREIGN KEY (`deleted_by`) REFERENCES `admins`(`id`)
//     ON UPDATE CASCADE ON DELETE SET NULL
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
