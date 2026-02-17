const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db");

const Booking = sequelize.define(
  "Booking",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    parentAdminId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,          // ✅
      defaultValue: null,       // ✅
      references: {
        model: "admins",
        key: "id",
      },
      onDelete: "SET NULL",     // ✅ safer than CASCADE
    },

    bookingType: {
      type: DataTypes.ENUM("free", "paid", "removed", "waiting list"),
      allowNull: false,
      defaultValue: "free",
      comment: "free = trial booking, paid = membership booking",
    },

    bookingId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    // ✅ NEW FIELD — FK → Leads.id
    leadId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "leads", // table name for leads
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Optional lead associated with the booking",
    },

    // ✅ FK → Venues.id
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

    // ✅ FK → ClassSchedules.id
    // classScheduleId: {
    //   type: DataTypes.BIGINT.UNSIGNED,
    //   allowNull: false,
    //   references: {
    //     model: "class_schedules",
    //     key: "id",
    //   },
    //   onUpdate: "CASCADE",
    //   onDelete: "CASCADE",
    // },
    classScheduleId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "class_schedules",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },

    // ✅ FK → PaymentPlans.id
    paymentPlanId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "payment_plans",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Selected payment plan for paid bookings",
    },

    trialDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Date of trial if bookingType = free",
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Date of start",
    },

    status: {
      type: DataTypes.ENUM(
        "pending",
        "attended",
        "assigned",
        "not attended",
        "cancelled",
        "rebooked",
        "no_membership",
        "active",
        "frozen",
        "waiting list",
        "request_to_cancel",
        "removed",
        "expired",
      ),
      allowNull: false,
      defaultValue: "pending",
    },

    totalStudents: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    interest: {
      type: DataTypes.ENUM("low", "medium", "high"),
      allowNull: false,
      defaultValue: "medium",
      comment: "Indicates the level of interest for the booking",
    },
    // ✅ NEW FIELD — trial conversion status
    isConvertedToMembership: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: null,
      comment: "Indicates if a trial booking has been converted to a paid membership",
    },

    // ✅ NEW FIELD — FK → Admins.id
    bookedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // ✅ allow null for website bookings
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Admin ID who created the booking (NULL for website bookings)",
    },
    source: {
      type: DataTypes.ENUM("admin", "website", "open"),
      allowNull: true,        // ✅ allow null
      defaultValue: null,     // ✅ real NULL
      comment: "Source of booking creation (admin / website / open)",
    },

    additionalNote: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Any extra notes for the booking",
    },
    reasonForNonAttendance: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Any extra notes for the booking",
    },

    // ============================
    //    🔹 NEW FIELD — attempt
    // ============================
    attempt: {
      type: DataTypes.INTEGER,
      allowNull: true,      // <----
      defaultValue: null,
    },

    // ===============================
    // 🔹 NEW FIELD — reactivate flag
    // ===============================
    reactivate: {
      type: DataTypes.ENUM("true", "false"),
      allowNull: true,      // <----
      defaultValue: null,
    },

    serviceType: {
      type: DataTypes.ENUM(
        "weekly class membership",
        "weekly class trial",
        "one to one",
        "birthday party"
      ),
      allowNull: true, // ✅ allow nulls
      defaultValue: null, // ✅ default is actually NULL, not 'NULL'
      comment: "Type of service for the booking",
    },

    // ===============================
    // 🔹 SALES ASSIGNMENT FIELDS
    // ===============================

    // Kaunsa agent is trial ko close karega
    assignedAgentId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // ✅ existing data safe
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Sales agent assigned to this trial",
    },

    // Kab agent assign hua
    assignedDate: {
      type: DataTypes.DATE,
      allowNull: true, // ✅ existing data safe
      comment: "Date when trial was assigned to agent",
    },

    // Kis agent ne final conversion ki
    convertedByAgentId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // ✅ existing data safe
      references: {
        model: "admins",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      comment: "Agent who converted trial to membership",
    },

    // Conversion kab hua
    convertedAt: {
      type: DataTypes.DATE,
      allowNull: true, // ✅ existing data safe
      comment: "Date when trial was converted to membership",
    },
  },
  {
    tableName: "booking",
    timestamps: true,
  }
);

Booking.associate = (models) => {
  Booking.hasOne(models.FreezeBooking, {
    foreignKey: "bookingId",
    as: "freezeBooking",
  });
};

module.exports = Booking;
