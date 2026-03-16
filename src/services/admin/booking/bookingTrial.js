const {
  sequelize,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  Venue,
  Admin,
  AdminRole,
  TermGroup,
  PaymentGroup,
  PaymentPlan,
  PaymentGroupHasPlan,
  Term,
} = require("../../../models");
const DEBUG = process.env.DEBUG === "true";
const generateReferralCode = require("../../../utils/generateReferralCode");
const { Op } = require("sequelize");
const bcrypt = require("bcrypt");

const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const sendSMS = require("../../../utils/sms/clickSend");

function generateBookingId(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();

  try {
    let parentAdminId = null;
    // let source = options?.source;
    const adminId = options?.adminId || null;
    const parentPortalAdminId = options?.parentAdminId || null;

    let source = "open"; // default = website

    // Parent portal MUST win first
    if (parentPortalAdminId) {
      source = "parent";
    }
    else if (adminId) {
      source = "admin";
    }

    const leadId = options?.leadId || null;

    if (DEBUG) {
      console.log("🔍 [DEBUG] Extracted adminId:", adminId);
      console.log("🔍 [DEBUG] Extracted source:", source);
      console.log("🔍 [DEBUG] Extracted leadId:", leadId);
    }

    if (source === "parent") {
      // ✅ Parent portal — parent already logged in
      if (!parentPortalAdminId) {
        throw new Error("Parent adminId is required for parent portal booking");
      }

      parentAdminId = parentPortalAdminId;

      if (DEBUG) {
        console.log("🔍 [DEBUG] Parent portal booking. parentAdminId:", parentAdminId);
      }
    }

    else if (data.parents?.length > 0) {
      const firstParent = data.parents[0];
      const email = firstParent.parentEmail?.trim()?.toLowerCase();

      if (!email) throw new Error("Parent email is required");

      const parentRole = await AdminRole.findOne({
        where: { role: "Parents" },
        transaction: t,
      });

      if (!parentRole) {
        throw new Error("Parent role not found");
      }
      const hashedPassword = await bcrypt.hash("Synco123", 10);

      if (source === "admin") {
        const existingAdmin = await Admin.findOne({
          where: { email },
          transaction: t,
        });

        if (existingAdmin) {
          throw new Error("Parent with this email already exists.");
        }
        // ✅ ADMIN PORTAL → ALWAYS CREATE NEW PARENT
        const admin = await Admin.create(
          {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
            // ✅ ADD THIS
            referralCode: generateReferralCode(),
          },
          { transaction: t }
        );

        parentAdminId = admin.id;

        if (DEBUG) {
          console.log("🔍 [DEBUG] Admin portal booking. New parent created:", parentAdminId);
        }
      } else {
        // ✅ WEBSITE BOOKING → findOrCreate
        const [admin, isCreated] = await Admin.findOrCreate({
          where: { email },
          defaults: {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
            // ✅ ADD THIS
            referralCode: generateReferralCode(),
          },
          transaction: t,
        });
        // 🛡️ Safety net (old parent but referralCode missing)
        if (!isCreated && !admin.referralCode) {
          admin.referralCode = generateReferralCode();
          await admin.save({ transaction });
        }

        parentAdminId = admin.id;

        if (DEBUG) {
          console.log("🔍 [DEBUG] Website booking parentAdminId:", parentAdminId);
        }
      }
    }

    let bookedBy = null;
    let bookingSource = null;

    if (source === "admin") {
      // 👨‍💼 Admin portal
      bookedBy = adminId;      // ✅ ALWAYS saved
      bookingSource = null;    // ✅ NULL
    }
    else {
      // 🌐 Website + 👪 Parent portal
      bookedBy = null;
      bookingSource = "website";
    }

    // Step 1: Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        // ✅ THIS IS THE KEY LINE
        parentAdminId: parentAdminId,
        bookingId: generateBookingId(12), // random booking reference
        leadId,
        totalStudents: data.totalStudents,
        // classScheduleId: data.classScheduleId,
        trialDate: data.trialDate,
        className: data.className,
        serviceType: "weekly class trial",
        attempt: 1,
        classTime: data.classTime,
        status: data.status || "pending",
        // bookedBy: source === "website" ? bookedByAdminId : adminId,
        bookedBy, // ✅ NULL for open booking
        source: bookingSource, // ✅ website for open booking
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t }
    );
    if (DEBUG) {
      console.log("✅ FINAL BOOKING VALUES", {
        parentAdminId,
        bookedBy,
        source: bookingSource,
      });
    }

    // Step 2: Create Students
    const studentIds = [];
    for (const student of data.students || []) {
      const studentMeta = await BookingStudentMeta.create(
        {
          bookingTrialId: booking.id,
          classScheduleId: student.classScheduleId, // ✅ HERE
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
      studentIds.push(studentMeta);
    }

    // Step 3: Create Parent Records
    if (data.parents && data.parents.length > 0 && studentIds.length > 0) {
      const firstStudent = studentIds[0];

      for (const [index, parent] of data.parents.entries()) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email || !emailRegex.test(email)) {
          throw new Error(`Invalid or missing parent email: ${email}`);
        }

        /*
        // Check duplicate email in BookingParentMeta
        const existingEmail = await BookingParentMeta.findOne({
          where: { parentEmail: email },
          transaction: t,
        });
        if (existingEmail) {
          throw new Error(`Parent with email ${email} already exists.`);
        }
        */

        // Always create BookingParentMeta for each parent
        await BookingParentMeta.create(
          {
            studentId: firstStudent.id,
            parentFirstName: parent.parentFirstName,
            parentLastName: parent.parentLastName,
            parentEmail: email,
            parentPhoneNumber: parent.parentPhoneNumber,
            relationToChild: parent.relationToChild,
            howDidYouHear: parent.howDidYouHear,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );
      }
    }

    // Step 4: Emergency Contact optional
    if (
      data.emergency &&
      data.emergency.emergencyFirstName &&
      data.emergency.emergencyPhoneNumber &&
      studentIds.length > 0
    ) {
      const firstStudent = studentIds[0];
      await BookingEmergencyMeta.create(
        {
          studentId: firstStudent.id,
          emergencyFirstName: data.emergency.emergencyFirstName,
          emergencyLastName: data.emergency.emergencyLastName,
          emergencyPhoneNumber: data.emergency.emergencyPhoneNumber,
          emergencyRelation: data.emergency.emergencyRelation,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction: t }
      );
    }

    // Step 5: Update Class Capacity
    const scheduleCountMap = {};

    for (const student of data.students) {
      scheduleCountMap[student.classScheduleId] =
        (scheduleCountMap[student.classScheduleId] || 0) + 1;
    }

    for (const [classScheduleId, count] of Object.entries(scheduleCountMap)) {
      const classSchedule = await ClassSchedule.findByPk(classScheduleId, { transaction: t });

      if (!classSchedule) {
        throw new Error(`ClassSchedule ${classScheduleId} not found`);
      }

      if (classSchedule.capacity < count) {
        throw new Error(`Not enough capacity for classScheduleId ${classScheduleId}`);
      }

      await classSchedule.update(
        { capacity: classSchedule.capacity - count },
        { transaction: t }
      );
    }

    // Step 6: Commit
    await t.commit();

    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentIds[0]?.id,
        studentFirstName: studentIds[0]?.studentFirstName,
        studentLastName: studentIds[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createBooking Error:", error);
    return { status: false, message: error.message };
  }
};

exports.getBookingByIdForWebsitePreview = async (
  id) => {
  console.log("🔍 getBookingById params:", { id });

  const whereClause = { id };

  try {
    console.log("🚀 Fetching booking from DB with whereClause:", whereClause);

    // 1️⃣ Fetch booking with related data
    const booking = await Booking.findOne({
      where: whereClause,
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: false,
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: true,
          include: [{ model: Venue, as: "venue", required: true }],
        },
      ],
    });

    if (!booking) {
      return { status: false, message: "Booking not found or not authorized." };
    }

    const venue = booking.classSchedule?.venue;

    // 2️⃣ Handle PaymentGroups
    let paymentGroups = [];
    if (venue?.paymentGroupId) {
      let paymentGroupIds = [];
      if (typeof venue.paymentGroupId === "string") {
        try {
          paymentGroupIds = JSON.parse(venue.paymentGroupId);
        } catch {
          paymentGroupIds = [];
        }
      } else if (Array.isArray(venue.paymentGroupId)) {
        paymentGroupIds = venue.paymentGroupId;
      } else {
        paymentGroupIds = [venue.paymentGroupId]; // single number
      }

      if (paymentGroupIds.length) {
        paymentGroups = await PaymentGroup.findAll({
          where: {
            id: { [Op.in]: paymentGroupIds }
          },
          include: [
            {
              model: PaymentPlan,
              as: "paymentPlans",
              through: { model: PaymentGroupHasPlan },
            },
          ],
          order: [["createdAt", "DESC"]],
        });
      }
    }

    // 3️⃣ Handle TermGroups + Terms with safe JSON parsing
    let termGroupIds = [];

    // Parse termGroupId from string/array/number
    if (typeof venue?.termGroupId === "string") {
      try {
        termGroupIds = JSON.parse(venue.termGroupId);
      } catch {
        termGroupIds = [];
      }
    } else if (Array.isArray(venue?.termGroupId)) {
      termGroupIds = venue.termGroupId;
    } else if (typeof venue?.termGroupId === "number") {
      termGroupIds = [venue.termGroupId];
    }

    const termGroups = termGroupIds.length
      ? await TermGroup.findAll({
        where: { id: termGroupIds },
      })
      : [];

    const terms = termGroupIds.length
      ? await Term.findAll({
        where: {
          termGroupId: { [Op.in]: termGroupIds },
        },
        attributes: [
          "id",
          "termName",
          "day",
          "startDate",
          "endDate",
          "termGroupId",
          "exclusionDates",
          "totalSessions",
          "sessionsMap",
        ],
      })
      : [];

    // Parse the terms safely
    const parsedTerms = terms.map((t) => ({
      id: t.id,
      name: t.termName,
      day: t.day,
      startDate: t.startDate,
      endDate: t.endDate,
      termGroupId: t.termGroupId,
      exclusionDates:
        typeof t.exclusionDates === "string"
          ? JSON.parse(t.exclusionDates)
          : t.exclusionDates || [],
      totalSessions: t.totalSessions,
      sessionsMap:
        typeof t.sessionsMap === "string"
          ? JSON.parse(t.sessionsMap)
          : t.sessionsMap || [],
    }));

    // 4️⃣ Extract students, parents, emergency contacts
    const students =
      booking.students?.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })) || [];

    const parents =
      booking.students
        ?.flatMap((s) => s.parents || [])
        .map((p) => ({
          id: p.id,
          parentId: p.parentId,
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        })) || [];

    const emergency =
      booking.students
        ?.flatMap((s) => s.emergencyContacts || [])
        .map((e) => ({
          id: e.id,
          emergencyId: e.emergencyId,
          emergencyFirstName: e.emergencyFirstName,
          emergencyLastName: e.emergencyLastName,
          emergencyPhoneNumber: e.emergencyPhoneNumber,
          emergencyRelation: e.emergencyRelation,
        })) || [];

    // 5️⃣ Build final response
    const response = {
      id: booking.id,
      bookingId: booking.bookingId,
      classScheduleId: booking.classScheduleId,
      attempt: booking.attempt,
      serviceType: booking.serviceType,
      trialDate: booking.trialDate,
      bookedBy: booking.bookedByAdmin || null,
      className: booking.className,
      classTime: booking.classTime,
      venueId: booking.venueId,
      status: booking.status,
      totalStudents: booking.totalStudents,
      createdAt: booking.createdAt,
      students,
      parents,
      emergency,
      classSchedule: booking.classSchedule || {},
      paymentGroups: paymentGroups.map((pg) => ({
        id: pg.id,
        name: pg.name,
        description: pg.description,
        createdBy: pg.createdBy,
        createdAt: pg.createdAt,
        updatedAt: pg.updatedAt,
        paymentPlans: (pg.paymentPlans || []).map((plan) => ({
          id: plan.id,
          title: plan.title,
          price: plan.price,
          priceLesson: plan.priceLesson,
          interval: plan.interval,
          duration: plan.duration,
          students: plan.students,
          joiningFee: plan.joiningFee,
          HolidayCampPackage: plan.HolidayCampPackage,
          termsAndCondition: plan.termsAndCondition,
          createdBy: plan.createdBy,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
          PaymentGroupHasPlan: plan.PaymentGroupHasPlan || null,
        })),
      })),
      termGroups: termGroups.map((tg) => ({ id: tg.id, name: tg.name })),
      terms: parsedTerms,
    };

    return {
      status: true,
      message: "Fetched booking details successfully.",
      data: response,
    };
  } catch (error) {
    console.error("❌ getBookingById Error:", error.message);
    return { status: false, message: error.message };
  }
};

// Get all admins (also include the logged-in admin)
exports.getAllAgents = async (superAdminId) => {
  if (!superAdminId || isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "No valid super admin found for this request.",
      data: [],
    };
  }

  try {
    const admins = await Admin.findAll({
      where: {
        superAdminId: Number(superAdminId),
        status: "active", // ✅ only active
      },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: {
            role: "Admin", // ✅ only Admin role
          },
          required: true,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} active admin(s) successfully.`,
      data: admins,
    };
  } catch (error) {
    console.error("❌ Sequelize Error in getAllAgents:", error);

    return {
      status: false,
      message:
        error?.parent?.sqlMessage ||
        error?.message ||
        "Failed to fetch agents.",
    };
  }
};

// Service: Assign bookings to an agent (only if status = "attended")
exports.assignBookingsToAgent = async ({ bookingIds, agentId }) => {
  const t = await sequelize.transaction();
  console.log("Transaction started");

  try {
    // Validation
    console.log("Validating input...");
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      throw new Error("At least one booking ID is required");
    }
    if (!agentId || isNaN(Number(agentId))) {
      throw new Error("Valid agent ID is required");
    }
    console.log("Input validated:", { bookingIds, agentId });

    // Check if agent exists
    console.log(`Checking if agent ${agentId} exists...`);
    const agent = await Admin.findByPk(agentId, { transaction: t });
    if (!agent) {
      throw new Error("Agent not found");
    }
    console.log("Agent found:", agent.id, agent.firstName || "No name");

    // Fetch bookings
    console.log("Fetching bookings...");
    const bookings = await Booking.findAll({
      where: { id: { [Op.in]: bookingIds } },
      transaction: t,
    });
    console.log("Bookings fetched:", bookings.map(b => ({ id: b.id, status: b.status, assignedAgentId: b.assignedAgentId })));

    if (bookings.length !== bookingIds.length) {
      throw new Error("One or more bookings were not found");
    }
    console.log("All bookings exist in DB");

    // Filter only attended bookings
    console.log("Filtering eligible bookings (status = 'attended')...");
    const eligibleBookings = bookings.filter(b => b.status === "attended");
    console.log("Eligible bookings:", eligibleBookings.map(b => b.id));

    if (eligibleBookings.length === 0) {
      throw new Error("No bookings with status 'attended' found to assign.");
    }

    // Check already assigned bookings
    console.log("Checking for already assigned bookings...");
    const alreadyAssigned = eligibleBookings.filter(b => b.assignedAgentId);
    if (alreadyAssigned.length > 0) {
      console.log("Already assigned bookings detected:", alreadyAssigned.map(b => b.id));
      throw new Error(`${alreadyAssigned.length} booking(s) are already assigned to an agent.`);
    }

    // Bulk update
    console.log("Updating eligible bookings to assign agent...");
    await Booking.update(
      {
        assignedAgentId: agentId,
        assignedDate: new Date(),
        status: "assigned",
        updatedAt: new Date(),
      },
      {
        where: { id: { [Op.in]: eligibleBookings.map(b => b.id) } },
        transaction: t,
      }
    );
    console.log("Bookings successfully updated:", eligibleBookings.map(b => b.id));

    await t.commit();
    console.log("Transaction committed");

    return {
      status: true,
      message: `${eligibleBookings.length} booking(s) successfully assigned to agent`,
      data: {
        bookingIds: eligibleBookings.map(b => b.id),
        assignedAgentId: agentId,
        totalAssigned: eligibleBookings.length,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("Transaction rolled back due to error:", error.message);
    return { status: false, message: error.message };
  }
};

// Get all booking with bookingType = free
exports.getAllBookings = async (filters = {}) => {
  try {
    const trialWhere = {};
    const venueWhere = {};

    trialWhere.bookingType = "free";

    if (filters.venueId) trialWhere.venueId = filters.venueId;
    if (filters.trialDate) trialWhere.trialDate = filters.trialDate;
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        trialWhere.status = { [Op.in]: filters.status };
      } else {
        trialWhere.status = filters.status;
      }
    }

    let allowedAdminIds = [];

    if (filters.bookedBy !== undefined) {
      allowedAdminIds = Array.isArray(filters.bookedBy)
        ? filters.bookedBy.map(Number)
        : [Number(filters.bookedBy)];
    }
    // ----------------------------
    // ✅ ACCESS CONTROL
    // ----------------------------
    let accessControl = {};

    if (filters.bookedBy && filters.bookedBy.adminIds?.length > 0) {
      const { type, adminIds } = filters.bookedBy;

      // ------------------------------------
      // SUPER ADMIN
      // ------------------------------------
      if (type === "super_admin") {
        accessControl = {
          [Op.or]: [
            // 1️⃣ Admin bookings → self + child admins
            {
              bookedBy: { [Op.in]: adminIds },
            },

            // 2️⃣ Website bookings → ONLY venues created by THIS super admin
            {
              bookedBy: null,
              source: "website",
              "$students.classSchedule.venue.createdBy$"
                : {
                [Op.in]: adminIds,
              },
            },
          ],
        };
      }

      // ------------------------------------
      // ADMIN
      // ------------------------------------
      else if (type === "admin") {
        accessControl = {
          [Op.or]: [
            // 1️⃣ Admin bookings → self + super admin
            {
              bookedBy: { [Op.in]: adminIds },
            },

            // 2️⃣ Website bookings → admin venues + super admin venues
            {
              bookedBy: null,
              source: "website",
              "$students.classSchedule.venue.createdBy$": {
                [Op.in]: adminIds,
              },
            },
          ],
        };
      }

      // ------------------------------------
      // AGENT
      // ------------------------------------
      else {
        accessControl = {
          bookedBy: { [Op.in]: adminIds },
        };
      }
    }

    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    }
    if (filters.venueName) {
      venueWhere.name = { [Op.like]: `%${filters.venueName}%` };
    }

    // ✅ Date filters
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateTrialFrom && filters.dateTrialTo) {
      const start = new Date(filters.dateTrialFrom + " 00:00:00");
      const end = new Date(filters.dateTrialTo + " 23:59:59");
      trialWhere.trialDate = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      trialWhere.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      trialWhere.createdAt = { [Op.lte]: end };
    }

    console.log("🔹 whereBooking:", trialWhere);

    const bookings = await Booking.findAll({
      order: [["id", "DESC"]],
      where: {
        bookingType: "free",
        serviceType: "weekly class trial",
        ...trialWhere,
        ...accessControl, // ✅ applied only if bookedBy filter exists
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              include: [
                {
                  model: Venue,
                  as: "venue",
                  where: filters.venueName
                    ? { name: { [Op.like]: `%${filters.venueName}%` } }
                    : undefined,
                  required: !!filters.venueName,
                },
              ],
            },
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: true,
        },
        // ✅ YEH NAYA ADD KIYA
        {
          model: Venue,
          as: "venue",
          where: filters.venueName
            ? { name: { [Op.like]: `%${filters.venueName}%` } }
            : undefined,
          required: !!filters.venueName,
        },
        {
          model: Admin,
          as: "bookedByAdmin",
          required: false,
        },
        {
          model: Admin,
          as: "assignedAgent",
          required: false,
        },
      ]

    });

    const parsedBookings = await Promise.all(
      bookings.map(async (booking) => {
        const students =
          booking.students?.map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
            attendance: s.attendance,

            // ✅ student-wise class schedule
            classSchedule: s.classSchedule
              ? {
                id: s.classSchedule.id,
                className: s.classSchedule.className,
                startTime: s.classSchedule.startTime,
                endTime: s.classSchedule.endTime,
              }
              : null,
          })) || [];

        const parents =
          booking.students?.[0]?.parents?.map((p) => ({
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || [];

        const emergency =
          booking.students?.[0]?.emergencyContacts?.map((e) => ({
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || [];

        const { venue: _venue, ...bookingData } = booking.dataValues;

        let venue = null;

        if (booking.students && booking.students.length) {
          for (const s of booking.students) {
            if (s.classSchedule?.venue) {
              venue = s.classSchedule.venue;
              break;
            }
          }
        }

        return {
          ...bookingData,
          students,
          parents,
          emergency,
          // ✅ booking-level venue (same for all students)
          venue,
          // classSchedule,

          ...(booking.bookedByAdmin
            ? {
              [booking.bookedByAdmin.role?.name === "Admin"
                ? "bookedByAdmin"
                : booking.bookedByAdmin.role?.name === "Agent"
                  ? "bookedByAgent"
                  : "bookedByOther"]: booking.bookedByAdmin,
            }
            : { bookedBy: null }),

          assignedAgent: booking.assignedAgent || null, // 👈 agent info
        };

      })
    );

    // Filter by student name if needed
    let finalBookings = parsedBookings;
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase().trim();

      finalBookings = parsedBookings.filter((booking) =>
        booking.students.some((s) => {
          const fullName = `${s.studentFirstName || ""} ${s.studentLastName || ""
            }`.toLowerCase();
          return fullName.includes(keyword);
        })
      );
    }
    // Collect all venues used in trials
    const venueMap = {};
    finalBookings.forEach((b) => {
      if (b.venue) venueMap[b.venue.id] = b.venue;
    });
    const allVenues = Object.values(venueMap);
    const bookedByMap = {};

    finalBookings.forEach((b) => {
      if (b.venue) venueMap[b.venue.id] = b.venue;

      if (b.bookedByAdmin || b.bookedByAgent || b.bookedByOther) {
        const bookedBy = b.bookedByAdmin || b.bookedByAgent || b.bookedByOther;
        if (bookedBy?.id) bookedByMap[bookedBy.id] = bookedBy;
      }
    });
    const allBookedBy = Object.values(bookedByMap);

    // --- Helper to calculate percentage change ---
    const getPercentageChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // --- STATS CALCULATION SECTION ---

    // ✅ Current period stats
    const totalFreeTrials = finalBookings.length;

    const attendedCount = finalBookings.filter(
      (b) => b.status === "attended"
    ).length;
    const freeTrialAttendanceRate =
      totalFreeTrials > 0
        ? Math.round((attendedCount / totalFreeTrials) * 100)
        : 0;
    // ✅ Fetch converted trial bookings separately
    const convertedTrialBookings = await Booking.findAll({
      where: {
        bookingType: "paid",
        serviceType: "weekly class membership",
        isConvertedToMembership: 1,
        ...accessControl,
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              include: [
                {
                  model: Venue,
                  as: "venue",
                },
              ],
            },
          ],
          required: false,
        },
      ],
    });
    console.log(
      "Converted Trial Bookings Count:",
      convertedTrialBookings.length
    );
    console.log(
      "Converted Booking IDs:",
      convertedTrialBookings.map(b => b.id)
    );

    const trialsToMembers = convertedTrialBookings.length;
    // ✅ Top Performer (Admin/Agent with most bookings)
    let topPerformer = null;
    if (allBookedBy.length > 0) {
      const countMap = {};
      finalBookings.forEach((b) => {
        const bookedBy = b.bookedByAdmin || b.bookedByAgent || b.bookedByOther;
        if (bookedBy?.id) {
          countMap[bookedBy.id] = (countMap[bookedBy.id] || 0) + 1;
        }
      });
      const topId = Object.keys(countMap).reduce((a, b) =>
        countMap[a] > countMap[b] ? a : b
      );
      topPerformer = allBookedBy.find((b) => b.id == topId);
    }

    // ✅ Previous period calculation (example: one month before same filters)
    let previousStats = { totalFreeTrials: 0, attended: 0, trialsToMembers: 0 };
    if (filters.trialDate) {
      const currentDate = new Date(filters.trialDate);
      const prevDate = new Date(currentDate);
      prevDate.setMonth(prevDate.getMonth() - 1);

      const prevBookings = await Booking.findAll({
        where: { ...trialWhere, trialDate: prevDate },
      });

      previousStats.totalFreeTrials = prevBookings.length;
      previousStats.attended = prevBookings.filter(
        (b) => b.status === "attended"
      ).length;
      previousStats.trialsToMembers = prevBookings.filter(
        (b) => b.paymentPlans?.length > 0
      ).length;
    }

    // ✅ Calculate percentage changes
    const stats = {
      totalFreeTrials: {
        value: totalFreeTrials,
        change: getPercentageChange(
          totalFreeTrials,
          previousStats.totalFreeTrials
        ),
      },
      freeTrialAttendanceRate: {
        value: freeTrialAttendanceRate,
        change: getPercentageChange(attendedCount, previousStats.attended),
      },
      trialsToMembers: {
        value: trialsToMembers,
        change: getPercentageChange(
          trialsToMembers,
          previousStats.trialsToMembers
        ),
      },
      topPerformer,
    };

    return {
      status: true,
      message: "Fetched free trial bookings successfully.",
      totalFreeTrials: finalBookings.length,
      data: {
        trials: finalBookings,
        venue: allVenues, // ✅ top-level array of all venues
        bookedByAdmin: allBookedBy,
        stats,
      },
    };
  } catch (error) {
    console.error("❌ getAllBookings Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getBookingById = async (id, bookedBy, adminId) => {
  if (!bookedBy || isNaN(Number(bookedBy))) {
    return {
      status: false,
      message: "No valid super admin found for this request.",
      data: [],
    };
  }
  try {
    const booking = await Booking.findOne({
      where: {
        bookedBy: Number(bookedBy),
        id, // spread the filters correctly
        serviceType: "weekly class trial",
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: false,
          include: [
            {
              model: ClassSchedule,
              as: "classSchedule",
              include: [
                {
                  model: Venue,
                  as: "venue",
                },
              ],
            },
            {
              model: BookingParentMeta,
              as: "parents",
              required: false,
            },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
        },
      ]
    });

    if (!booking) {
      return {
        status: false,
        message: "Booking not found or not authorized.",
      };
    }

    const firstStudent = booking.students?.[0] || null;
    const venue =
      firstStudent?.classSchedule?.venue || null;

    // Final Response — no .toJSON() and no field picking
    return {
      status: true,
      message: "Fetched booking details successfully.",
      data: {
        ...booking.dataValues, // includes all booking fields
        students: booking.students || [],
        venue,
        classSchedule: booking.classSchedule || null, // full object
        // paymentPlans,
      },
    };
  } catch (error) {
    console.error("❌ getBookingById Error:", error.message);
    return {
      status: false,
      message: error.message,
    };
  }
};

exports.sendAllEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch booking
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // 2️⃣ Get all students for this booking
    const studentMetas = await BookingStudentMeta.findAll({
      where: { bookingTrialId: bookingId },
    });

    if (!studentMetas.length) {
      return { status: false, message: "No students found for this booking" };
    }

    // 3️⃣ Venue & Class info
    const venue = await Venue.findByPk(booking.venueId);
    const classSchedule = await ClassSchedule.findByPk(booking.classScheduleId);

    const venueName = venue?.venueName || venue?.name || "Unknown Venue";
    const className = classSchedule?.className || "Unknown Class";
    const classTime =
      classSchedule?.classTime || classSchedule?.startTime || "TBA";
    const trialDate = booking.trialDate;
    const additionalNote = booking.additionalNote || "";

    // 4️⃣ Email template
    const emailConfigResult = await getEmailConfig(
      "admin",
      "send email trialist"
    );
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Build students block (table or list)
    let studentsHtml = "<ul>";
    for (const s of studentMetas) {
      studentsHtml += `<li>${s.studentFirstName} ${s.studentLastName} (Age: ${s.age}, Gender: ${s.gender})</li>`;
    }
    studentsHtml += "</ul>";

    // 6️⃣ Get unique parents across all students
    const allParents = await BookingParentMeta.findAll({
      where: { studentId: studentMetas.map((s) => s.id) },
    });

    const parentsMap = {};
    for (const parent of allParents) {
      if (parent?.parentEmail) {
        parentsMap[parent.parentEmail] = parent;
      }
    }

    // 7️⃣ Send one email per parent with all students listed
    for (const parentEmail in parentsMap) {
      const parent = parentsMap[parentEmail];

      let noteHtml = "";
      if (additionalNote && additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      let finalHtml = htmlTemplate
        .replace(/{{parentName}}/g, parent.parentFirstName)
        .replace(/{{studentsList}}/g, studentsHtml) // 🔑 add this placeholder in template
        .replace(/{{status}}/g, booking.status)
        .replace(/{{venueName}}/g, venueName)
        .replace(/{{className}}/g, className)
        .replace(/{{classTime}}/g, classTime)
        .replace(/{{trialDate}}/g, trialDate)
        .replace(/{{additionalNoteSection}}/g, noteHtml)
        .replace(/{{appName}}/g, "Synco")
        .replace(
          /{{logoUrl}}/g,
          "https://webstepdev.com/demo/syncoUploads/syncoLogo.png"
        )
        .replace(
          /{{kidsPlaying}}/g,
          "https://webstepdev.com/demo/syncoUploads/kidsPlaying.png"
        )
        .replace(/{{year}}/g, new Date().getFullYear());

      const recipient = [
        {
          name: `${parent.parentFirstName} ${parent.parentLastName}`,
          email: parent.parentEmail,
        },
      ];

      const sendResult = await sendEmail(emailConfig, {
        recipient,
        subject,
        htmlBody: finalHtml,
      });

      if (sendResult.status) {
        sentTo.push(parent.parentEmail);
      }
    }

    return {
      status: true,
      message: `Emails sent to ${sentTo.length} parents`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendEmailToParents Error:", error);
    return { status: false, message: error.message };
  }
};

exports.sendAllSMSToParents = async ({ bookingId }) => {
  try {
    const bookingIds = Array.isArray(bookingId) ? bookingId : [bookingId];
    let sentTo = [];

    for (const id of bookingIds) {
      // 1️⃣ Fetch booking
      const booking = await Booking.findByPk(id);
      if (!booking) {
        console.warn(`⚠️ Booking not found: ${id}`);
        continue;
      }

      // 2️⃣ Fetch students
      const studentMetas = await BookingStudentMeta.findAll({
        where: { bookingTrialId: id },
      });
      if (!studentMetas.length) {
        console.warn(`⚠️ No students for booking: ${id}`);
        continue;
      }

      // 3️⃣ First parent only
      const firstParent = await BookingParentMeta.findOne({
        where: { studentId: studentMetas[0].id },
        order: [["id", "ASC"]],
      });
      if (!firstParent?.parentPhoneNumber) {
        console.warn(`⚠️ No parent phone for booking: ${id}`);
        continue;
      }

      const phone = firstParent.parentPhoneNumber;

      // 4️⃣ Validate phone format
      if (!phone.startsWith("+")) {
        console.warn("⚠️ Invalid phone format:", phone);

        return {
          status: false,
          message: "Invalid phone number format. Phone must start with + and country code.",
        };
      }

      // 5️⃣ Build professional message based on booking type & status
      let message = `Hello, this is Synco. `;

      switch (booking.bookingType) {
        case "free":
          message += `Your trial booking on ${booking.trialDate} `;
          if (booking.status === "attended") {
            message += `was attended. We hope your child enjoyed the class.`;
          } else if (booking.status === "not attended") {
            message += `was missed. Please contact us to reschedule.`;
          } else {
            message += `is confirmed. We look forward to seeing your child.`;
          }
          break;

        case "paid":
          message += `Your membership booking `;
          if (booking.startDate) message += `starting on ${booking.startDate} `;
          message += `is ${booking.status}. Thank you for choosing Synco.`;
          break;

        case "waiting list":
          message += `Your request to join is on the waiting list. We will notify you once a spot becomes available.`;
          break;

        default:
          message += `Your booking is confirmed. Thank you for being with Synco.`;
      }

      // 6️⃣ Send SMS
      const smsResult = await sendSMS(phone, message);

      if (smsResult.success) {
        sentTo.push({ bookingId: id, phone });

        // Log SMS cost (optional)
        const cost = smsResult?.data?.data?.messages?.[0]?.message_price;
        if (DEBUG && cost) {
          console.log(`💰 SMS Cost for booking ${id}:`, cost);
        }
      }

      if (DEBUG) {
        console.log("📲 SMS sent:", { bookingId: id, phone, success: smsResult.success });
      }
    }

    return {
      status: true,
      message: `SMS sent for ${sentTo.length} booking(s)`,
      sentTo,
    };
  } catch (error) {
    console.error("❌ sendAllSMSToParents Error:", error);
    return { status: false, message: error.message };
  }
};

// Get parent by ID
exports.getParentById = async (parentAdminId) => {
  try {
    // ✅ Admin basic info
    const admin = await Admin.findByPk(parentAdminId, {
      attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
    });

    if (!admin) {
      return { status: false, message: "Parent not found" };
    }

    // ✅ Fetch only 2 fields from parent meta
    const booking = await Booking.findOne({
      where: { parentAdminId },
      attributes: ["id"],

      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          attributes: ["id"],
          required: false,
          include: [
            {
              model: BookingParentMeta,
              as: "parents",
              attributes: ["relationToChild", "howDidYouHear"],
              required: false,
            },
          ],
        },
      ],
    });
    console.log(await Booking.count({ where: { parentAdminId } }));

    const parentMeta = booking?.students?.[0]?.parents?.[0];

    return {
      status: true,
      message: "Parent data fetched successfully.",
      data: {
        id: admin.id,
        parentFirstName: admin.firstName,
        parentLastName: admin.lastName,
        parentEmail: admin.email,
        parentPhoneNumber: admin.phoneNumber,
        relationToChild: parentMeta?.relationToChild || null,
        howDidYouHear: parentMeta?.howDidYouHear || null,
      },
    };
  } catch (error) {
    console.error(error);
    return { status: false, message: error.message };
  }
};
