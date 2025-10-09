const { sequelize } = require("../config/db");

// =================== Import All Models =================== //
const models = {
  // 🌐 Core
  Admin: require("./admin/Admin"),
  EmailConfig: require("./Email"),

  // 📋 Activity & Logs
  ActivityLog: require("./admin/ActivityLog"),

  // 👥 Admin Roles & Permission
  AdminRole: require("./admin/AdminRole"),
  AdminRolePermission: require("./admin/AdminRolePermission"),
  AdminRoleHasPermission: require("./admin/AdminRoleHasPermission"),

  // 🔔 Notifications
  Notification: require("./admin/notification/Notification"),
  NotificationRead: require("./admin/notification/NotificationRead"),
  CustomNotification: require("./admin/notification/CustomNotification"),
  CustomNotificationRead: require("./admin/notification/CustomNotificationRead"),

  // 💳 Payment System
  PaymentPlan: require("./admin/payment/PaymentPlan"),
  PaymentGroup: require("./admin/payment/PaymentGroup"),
  PaymentGroupHasPlan: require("./admin/payment/PaymentGroupHasPlan"),

  // 🎟️ Discount System
  Discount: require("./admin/discount/Discount"),
  DiscountAppliesTo: require("./admin/discount/DiscountAppliesTo"),
  DiscountUsage: require("./admin/discount/DiscountUsage"),

  // 🌍 Location System
  Country: require("./admin/location/Country"),
  State: require("./admin/location/State"),
  City: require("./admin/location/City"),

  //Session Plan
  SessionExercise: require("./admin/sessionPlan/SessionExercise"),
  SessionPlanGroup: require("./admin/sessionPlan/SessionPlanGroup"),

  //Terms and Dates
  TermGroup: require("./admin/termAndDates/TermGroup"),
  Term: require("./admin/termAndDates/Term"),

  //Venue
  Venue: require("./admin/venue/venue"),

  //Class Schedule
  ClassSchedule: require("./admin/classSchedule/ClassSchedule"),
  ClassScheduleTermMap: require("./admin/classSchedule/ClassScheduleTermMap"),

  //cancel class
  CancelSession: require("./admin/classSchedule/CancelSession"),

  //Book Free trails
  Booking: require("./admin/booking/Booking"),
  BookingStudentMeta: require("./admin/booking/BookingStudentMeta"),
  BookingParentMeta: require("./admin/booking/BookingParentMeta"),
  BookingEmergencyMeta: require("./admin/booking/BookingEmergencyMeta"),
  RebookingTrial: require("./admin/booking/RebookFreeTrial"),
  CancelBooking: require("./admin/booking/CancelBooking"),
  // WaitingList: require("./admin/booking/WaitingList"),
  FreezeBooking: require("./admin/booking/FreezeBooking"),
  KeyInformation: require("./admin/booking/KeyInformation"),
  Comment: require("./admin/booking/Comment"),

  // Book MemberShip
  BookingPayment: require("./admin/booking/BookingPayment"),
  Credits: require("./admin/booking/Credits"),

  Feedback: require("./admin/accountInformations/Feedback"),
  AdminDashboardWidget: require("./admin/adminDashboard/adminDashboardWidget"),
  Lead: require("./admin/lead/Leads"),

  SessionPlanConfig: require("./admin/oneToOne/SessionPlanConfig"),

};

// =================== Apply Model-Level Associations =================== //
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

// ====================== 🔗 Manual Relationships ====================== //

const {
  Admin,
  AdminRole,
  AdminRolePermission,
  AdminRoleHasPermission,
  EmailConfig,
  ActivityLog,
  Notification,
  NotificationRead,
  CustomNotification,
  CustomNotificationRead,
  Country,
  State,
  City,
  PaymentPlan,
  PaymentGroup,
  PaymentGroupHasPlan,
  Discount,
  DiscountAppliesTo,
  DiscountUsage,
  SessionExercise,
  SessionPlanGroup,
  TermGroup,
  Term,
  Venue,
  ClassSchedule,
  ClassScheduleTermMap,
  CancelSession,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  RebookingTrial,
  CancelBooking,
  BookingPayment,
  Comment,
  AdminDashboardWidget,
  // WaitingList,
  FreezeBooking,
  Credits,
  Feedback,
  Lead,
  KeyInformation,

  SessionPlanConfig,
} = models;

// Many-to-Many
Term.belongsToMany(SessionPlanGroup, {
  through: "term_session_plan_groups",
  foreignKey: "termId",
  otherKey: "sessionPlanGroupId",
  as: "sessionPlanGroups",
});

SessionPlanGroup.belongsToMany(Term, {
  through: "term_session_plan_groups",
  foreignKey: "sessionPlanGroupId",
  otherKey: "termId",
  as: "terms",
});

TermGroup.hasMany(Term, {
  foreignKey: "termGroupId",
  as: "terms",
  onDelete: "CASCADE",
});
Term.belongsTo(TermGroup, {
  foreignKey: "termGroupId",
  as: "termGroup",
  onDelete: "CASCADE",
});
Term.associate = (models) => {
  Term.belongsTo(models.TermGroup, {
    foreignKey: "termGroupId",
    as: "termGroup",
    onDelete: "CASCADE",
  });
};
TermGroup.associate = (models) => {
  TermGroup.hasMany(models.Term, {
    foreignKey: "termGroupId",
    as: "terms",
    onDelete: "CASCADE",
  });
};

// Venue.belongsTo(models.PaymentPlan, {
//   foreignKey: "paymentPlanId",
//   as: "paymentPlan",
// });
Venue.belongsTo(models.PaymentPlan, {
  foreignKey: "paymentGroupId",
  as: "paymentGroup",
});

// 🧩 Booking <-> Student/Parent/Emergency
Booking.hasMany(BookingStudentMeta, {
  as: "students",
  foreignKey: "bookingTrialId",
  onDelete: "CASCADE",
});

Booking.hasMany(Feedback, { as: "feedbacks", foreignKey: "bookingId" });
Feedback.belongsTo(Booking, { as: "booking", foreignKey: "bookingId" });

// 🧩 Booking -> ClassSchedule -> Venue
Booking.belongsTo(ClassSchedule, {
  as: "classSchedule",
  foreignKey: "classScheduleId",
});
Booking.belongsTo(models.Venue, { foreignKey: "venueId", as: "venue" });

RebookingTrial.belongsTo(models.Booking, {
  foreignKey: "bookingTrialId",
  as: "booking",
  onDelete: "CASCADE",
});

// CancelBooking model
CancelBooking.belongsTo(models.Booking, {
  foreignKey: "bookingId",
  as: "booking",
  onDelete: "CASCADE",
});

// Booking → BookingPayment
Booking.hasMany(BookingPayment, {
  foreignKey: "bookingId", // FK in BookingPayment
  as: "payments", // Must match the alias in include
});

// Booking → PaymentPlan (direct)
Booking.belongsTo(PaymentPlan, {
  as: "paymentPlan", // Alias used in include
  foreignKey: "paymentPlanId", // Booking table field
});
Booking.belongsTo(Admin, { foreignKey: "bookedBy", as: "bookedByAdmin" });
Booking.belongsTo(Admin, { foreignKey: "bookedBy", as: "admin" });

BookingParentMeta.associate = (models) => {
  BookingParentMeta.belongsTo(models.BookingStudentMeta, {
    foreignKey: "studentId",
    as: "student",
    onDelete: "CASCADE",
  });
};

BookingEmergencyMeta.associate = (models) => {
  BookingEmergencyMeta.belongsTo(models.BookingStudentMeta, {
    foreignKey: "studentId",
    as: "student",
    onDelete: "CASCADE",
  });
};

CancelSession.associate = (models) => {
  CancelSession.belongsTo(models.ClassSchedule, {
    foreignKey: "classScheduleId",
    as: "classSchedule",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};
Venue.hasMany(Booking, { foreignKey: "venueId", as: "bookings" });

// Booking → CancelBooking
Booking.hasOne(CancelBooking, {
  foreignKey: "bookingId",
  as: "cancelData", // ✅ unique
});

CancelBooking.belongsTo(Booking, {
  foreignKey: "bookingId",
  as: "bookingInfo", // ✅ make unique
});

ClassSchedule.hasMany(models.Booking, {
  foreignKey: "classScheduleId",
  as: "booking", // ⚡ must match service include
});

ClassSchedule.hasMany(Feedback, {
  as: "feedbacks",
  foreignKey: "classScheduleId",
});

Feedback.belongsTo(ClassSchedule, {
  as: "classSchedule",
  foreignKey: "classScheduleId",
});

Lead.belongsTo(Admin, {
  foreignKey: "assignedAgentId",
  as: "assignedAgent",
});

// Lead.js
Lead.hasMany(models.Booking, {
  foreignKey: "leadId",
  as: "bookings",
});

// Booking.js
Booking.belongsTo(models.Lead, {
  foreignKey: "leadId",
  as: "lead",
});

// ✅ Associate Comment → Admin
Comment.belongsTo(models.Admin, {
  foreignKey: "commentBy",
  as: "bookedByAdmin",
});

// ====================== 📦 Module Exports ====================== //
module.exports = {
  sequelize,
  Admin,
  AdminRole,
  AdminRolePermission,
  AdminRoleHasPermission,

  ActivityLog,
  EmailConfig,

  Notification,
  NotificationRead,
  CustomNotification,
  CustomNotificationRead,

  PaymentPlan,
  PaymentGroup,
  PaymentGroupHasPlan,

  Discount,
  DiscountAppliesTo,
  DiscountUsage,

  Country,
  State,
  City,

  SessionExercise,
  SessionPlanGroup,

  TermGroup,
  Term,

  Venue,
  ClassSchedule,
  ClassScheduleTermMap,
  CancelSession,

  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  RebookingTrial,
  CancelBooking,

  BookingPayment,
  Comment,
  AdminDashboardWidget,
  // WaitingList,
  FreezeBooking,
  Credits,
  Feedback,
  Lead,
  KeyInformation,
  SessionPlanConfig,
};
