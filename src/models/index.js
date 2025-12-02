const { sequelize } = require("../config/db");

// =================== Import All Models =================== //
const models = {
  // 🌐 Core
  Admin: require("./admin/Admin"),
  EmailConfig: require("./Email"),

  AppConfig: require("./AppConfig"),

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

  //Book Free Trials
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

  oneToOneLeads: require("./admin/oneToOne/oneToOneLeads"),
  OneToOneBooking: require("./admin/oneToOne/booking/OneToOneBooking"),
  OneToOneStudent: require("./admin/oneToOne/booking/OneToOneStudent"),
  OneToOneParent: require("./admin/oneToOne/booking/OneToOneParent"),
  OneToOneEmergency: require("./admin/oneToOne/booking/OneToOneEmergency"),
  OneToOnePayment: require("./admin/oneToOne/booking/OneToOnePayment"),

  BirthdayPartyLead: require("./admin/birthdayParty/BirthdayPartyLeads"),
  BirthdayPartyBooking: require("./admin/birthdayParty/booking/BirthdayPartyBooking"),
  BirthdayPartyStudent: require("./admin/birthdayParty/booking/BirthdayPartyStudent"),
  BirthdayPartyParent: require("./admin/birthdayParty/booking/BirthdayPartyParent"),
  BirthdayPartyEmergency: require("./admin/birthdayParty/booking/BirthdayPartyEmergency"),
  BirthdayPartyPayment: require("./admin/birthdayParty/booking/BirthdayPartyPayment"),

  //  Holiday camp Module

  // subscription plan manager
  HolidayPaymentGroup: require("./admin/holidayCamps/payment/HolidayPaymentGroup"),
  HolidayPaymentPlan: require("./admin/holidayCamps/payment/HolidayPaymentPlan"),
  HolidayPaymentGroupHasPlan: require("./admin/holidayCamps/payment/HolidayPaymentGroupHasPlan"),

  // //Session Plan
  HolidaySessionExercise: require("./admin/holidayCamps/sessionPlan/HolidaySessionExercise"),
  HolidaySessionPlanGroup: require("./admin/holidayCamps/sessionPlan/HolidaySessionPlanGroup"),

  //Terms and Dates
  HolidayCamp: require("./admin/holidayCamps/campsAndDates/HolidayCamp"),
  HolidayCampDates: require("./admin/holidayCamps/campsAndDates/HolidayCampDates"),

  HolidayVenue: require("./admin/holidayCamps/venue/HolidayVenue"),
  HolidayClassSchedule: require("./admin/holidayCamps/classSchedule/HolidayClassSchedule"),

  HolidayClassScheduleTermMap: require("./admin/holidayCamps/classSchedule/HolidayClassScheduleTermMap"),
  HolidayCancelSession: require("./admin/holidayCamps/classSchedule/HolidayCancelSession"),

  HolidayBooking: require("./admin/holidayCamps/booking/HolidayBooking"),
  HolidayBookingStudentMeta: require("./admin/holidayCamps/booking/HolidayBookingStudentMeta"),
  HolidayBookingParentMeta: require("./admin/holidayCamps/booking/HolidayBookingParentMeta"),
  HolidayBookingEmergencyMeta: require("./admin/holidayCamps/booking/HolidayBookingEmergencyMeta"),
  HolidayBookingPayment: require("./admin/holidayCamps/booking/HolidayBookingPayment"),

  CustomTemplate: require("./admin/holidayCamps/emailAndTextTemplates/customTemplate/CustomTemplate"),
  TemplateCategory: require("./admin/holidayCamps/emailAndTextTemplates/templatecategory/TemplateCategory"),
  ToDoList: require("./admin/holidayCamps/toDoList/ToDoList"),
};

// =================== Apply Model-Level Associations =================== //
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

// ====================== 🔗 Manual Relationships ====================== //

const {
  AppConfig,
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
  oneToOneLeads,
  OneToOneBooking,
  OneToOneStudent,
  OneToOneParent,
  OneToOneEmergency,
  OneToOnePayment,

  BirthdayPartyLead,
  BirthdayPartyBooking,
  BirthdayPartyStudent,
  BirthdayPartyParent,
  BirthdayPartyEmergency,
  BirthdayPartyPayment,

  HolidaySessionExercise,
  HolidaySessionPlanGroup,

  HolidayCamp,
  HolidayCampDates,

  HolidayPaymentGroup,
  HolidayPaymentPlan,
  HolidayPaymentGroupHasPlan,

  HolidayVenue,
  HolidayClassSchedule,

  HolidayClassScheduleTermMap,
  HolidayCancelSession,

  HolidayBooking,
  HolidayBookingStudentMeta,
  HolidayBookingParentMeta,
  HolidayBookingEmergencyMeta,
  HolidayBookingPayment,

  CustomTemplate,
  TemplateCategory,
  ToDoList,

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

OneToOneBooking.belongsTo(models.oneToOneLeads, {
  foreignKey: "leadId",
  as: "lead",
});

// Holiday camps associations 
// HolidayCamp → HolidayCampDates (1:M)
HolidayCamp.hasMany(HolidayCampDates, {
  foreignKey: "holidayCampId",
  as: "holidayCampDates",
  onDelete: "CASCADE",
});

HolidayCampDates.belongsTo(HolidayCamp, {
  foreignKey: "holidayCampId",
  as: "holidayCamp",
  onDelete: "CASCADE",
});

// HolidayCampDates ↔ HolidaySessionPlanGroup (M:M)
HolidayCampDates.belongsToMany(HolidaySessionPlanGroup, {
  through: "holiday_camp_dates_session_plan_groups",
  foreignKey: "holidayCampDatesId",
  otherKey: "holidaySessionPlanGroupId",
  as: "holidaySessionPlanGroups",
});

HolidaySessionPlanGroup.belongsToMany(HolidayCampDates, {
  through: "holiday_camp_dates_session_plan_groups",
  foreignKey: "holidaySessionPlanGroupId",
  otherKey: "holidayCampDatesId",
  as: "holidayCampDates",
});

HolidayVenue.belongsTo(models.HolidayPaymentGroup, {
  foreignKey: "paymentGroupId",
  as: "holidayPaymentGroup",
});

HolidayBooking.hasMany(HolidayBookingStudentMeta, {
  foreignKey: "bookingId",
  as: "students"
});

HolidayBooking.associate = (models) => {

  HolidayBooking.hasMany(models.HolidayBookingPayment, {
    foreignKey: "holiday_booking_id",
    as: "payments",
  });

};
// 🧩 Booking -> ClassSchedule -> Venue
HolidayBooking.belongsTo(HolidayClassSchedule, {
  as: "holidayClassSchedules",
  foreignKey: "classScheduleId",
});
HolidayBooking.belongsTo(models.HolidayVenue, { foreignKey: "venueId", as: "holidayVenue" });

HolidayBooking.belongsTo(models.HolidayPaymentPlan, {
  foreignKey: "paymentPlanId",
  as: "holidayPaymentPlan",
});

// 🔹 A booking can have an optional discount
HolidayBooking.belongsTo(models.Discount, {
  foreignKey: "discountId",
  as: "discount",
});

HolidayBooking.belongsTo(HolidayCamp, {
  foreignKey: "holidayCampId",
  as: "holidayCamp"
});
HolidayCamp.hasMany(HolidayBooking, {
  foreignKey: "holidayCampId",
  as: "bookings"
});

HolidayBooking.belongsTo(Admin, { foreignKey: 'bookedBy', as: 'bookedByAdmin' });

// ====================== 📦 Module Exports ====================== //
module.exports = {
  AppConfig,
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
  oneToOneLeads,
  OneToOneBooking,
  OneToOneStudent,
  OneToOneParent,
  OneToOneEmergency,
  OneToOnePayment,
  BirthdayPartyLead,
  BirthdayPartyBooking,
  BirthdayPartyStudent,
  BirthdayPartyParent,
  BirthdayPartyEmergency,
  BirthdayPartyPayment,

  HolidaySessionExercise,
  HolidaySessionPlanGroup,

  HolidayCamp,
  HolidayCampDates,

  HolidayPaymentGroup,
  HolidayPaymentPlan,
  HolidayPaymentGroupHasPlan,

  HolidayVenue,
  HolidayClassSchedule,

  HolidayClassScheduleTermMap,
  HolidayCancelSession,

  HolidayBooking,
  HolidayBookingStudentMeta,
  HolidayBookingParentMeta,
  HolidayBookingEmergencyMeta,
  HolidayBookingPayment,

  CustomTemplate,
  TemplateCategory,
  ToDoList,

};
