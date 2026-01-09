const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../../config/db");

const HolidayBooking = sequelize.define(
    "HolidayBooking",
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        bookingType: {
            type: DataTypes.ENUM("paid", "removed", "waiting list", "cancelled"),
            allowNull: false,
            defaultValue: "waiting list",
            comment: "booking, paid = membership booking",
        },

        // ✅ FK → Venues.id
        venueId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "holiday_venues",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
        },

        holidayCampId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "holiday_camp",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",

        },
        discountId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: "discounts",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
            comment: "Applied discount (if any)",
        },

        // ✅ FK → ClassSchedules.id
        classScheduleId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: "holiday_class_schedules",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
        },

        // ✅ FK → PaymentPlans.id
        paymentPlanId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: "holiday_payment_plans",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
            comment: "Selected payment plan for paid bookings",
        },
        parentAdminId: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            defaultValue: null,
            references: {
                model: "admins",
                key: "id",
            },
            onDelete: "SET NULL",
        },

        status: {
            type: DataTypes.ENUM(
                "pending",
                "attended",
                "not attended",
                "cancelled",
                "active",
                "frozen",
                "waiting list",
                "removed"
            ),
            allowNull: false,
            defaultValue: "pending",
        },

        totalStudents: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
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
            allowNull: true,          // ✅ allow website bookings
            defaultValue: null,
            references: {
                model: "admins",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",     // ✅ safer
            comment: "Admin ID who created the booking (null = website)",
        },

        cancelReason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: "Reason for cancellation (if status = cancelled)",
        },

        additionalNotes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: "Extra notes for booking",
        },

        serviceType: {
            type: DataTypes.ENUM(
                "weekly class membership",
                "weekly class trial",
                "one to one",
                "birthday party",
                "holiday camp"
            ),
            allowNull: true,
            defaultValue: null,
            comment: "Type of service for the booking",
        },
        marketingChannel: {
            type: DataTypes.ENUM(
                "facebook",
                "instagram",
                "referral",
                "website",
                "others",
                "social",
                "admin",
            ),
            allowNull: false,
            defaultValue: "admin",
            comment: "Marketing source of the booking",
        },
    },
    {
        tableName: "holiday_booking",
        timestamps: true,
    }
);
HolidayBooking.associate = (models) => {
    HolidayBooking.hasOne(models.HolidayBookingPayment, {
        foreignKey: "holiday_booking_id",
        as: "payment",
    });

};

module.exports = HolidayBooking;
