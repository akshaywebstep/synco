const {
  sequelize,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  ClassSchedule,
  Venue,
  PaymentPlan,
  Admin,
  AdminRole,
} = require("../../../models");
const DEBUG = process.env.DEBUG === "true";

const { Op } = require("sequelize");
const bcrypt = require("bcrypt");

const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");

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

    if (adminId) {
      source = "admin";
    } else if (parentPortalAdminId) {
      source = "parent";
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
          },
          { transaction: t }
        );

        parentAdminId = admin.id;

        if (DEBUG) {
          console.log("🔍 [DEBUG] Admin portal booking. New parent created:", parentAdminId);
        }
      }

      else {
        // ✅ WEBSITE BOOKING → findOrCreate
        const [admin] = await Admin.findOrCreate({
          where: { email },
          defaults: {
            firstName: firstParent.parentFirstName || "Parent",
            lastName: firstParent.parentLastName || "",
            phoneNumber: firstParent.parentPhoneNumber || "",
            email,
            password: hashedPassword,
            roleId: parentRole.id,
            status: "active",
          },
          transaction: t,
        });

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
        classScheduleId: data.classScheduleId,
        trialDate: data.trialDate,
        className: data.className,
        serviceType: "weekly class trial",
        attempt: 1,
        classTime: data.classTime,
        status: data.status || "active",
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
    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId);
    const newCapacity = classSchedule.capacity - data.totalStudents;
    if (newCapacity < 0) throw new Error("Not enough capacity left.");
    await classSchedule.update({ capacity: newCapacity }, { transaction: t });

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

// Get all admins (also include the logged-in admin)
exports.getAllAgents = async (
  superAdminId,
  loggedInAdminId,
  includeSuperAdmin = false
) => {
  if (!superAdminId || isNaN(Number(superAdminId))) {
    return {
      status: false,
      message: "No valid parent or super admin found for this request.",
      data: [],
    };
  }

  try {
    const orConditions = [{ superAdminId: Number(superAdminId) }];

    // include super admin themselves
    if (includeSuperAdmin) {
      orConditions.push({ id: Number(superAdminId) });
    }

    // include currently logged-in admin
    if (loggedInAdminId) {
      orConditions.push({ id: Number(loggedInAdminId) });
    }

    const admins = await Admin.findAll({
      where: {
        [Op.or]: orConditions,
      },
      include: [
        {
          model: AdminRole,
          as: "role",
          attributes: ["id", "role"],
          where: {
            role: {
              [Op.in]: ["Super Admin", "Admin"], // ✅ only these roles
            },
          },
          required: true, // ✅ ensures role filter is enforced
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      status: true,
      message: `Fetched ${admins.length} admin(s) successfully.`,
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

exports.assignBookingsToAgent = async ({ bookingIds, bookedBy }) => {
  const t = await sequelize.transaction();

  try {
    // Validation
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      throw new Error("At least one booking ID is required");
    }
    if (!bookedBy || isNaN(Number(bookedBy))) {
      throw new Error("Valid agent ID is required");
    }

    // Check Agent Exists
    const agent = await Admin.findByPk(bookedBy, {
      include: [{ model: AdminRole, as: "role" }],
      transaction: t,
    });
    if (!agent) {
      throw new Error("Agent not found");
    }

    // Fetch Bookings with students and parents eager loaded
    const bookings = await Booking.findAll({
      where: {
        id: { [Op.in]: bookingIds },
      },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents", required: false },
          ],
          required: false,
        },
      ],
      transaction: t,
    });

    if (bookings.length !== bookingIds.length) {
      throw new Error("One or more bookings were not found");
    }

    // Filter bookings that are already assigned
    const alreadyAssigned = bookings.filter((b) => b.bookedBy);

    if (alreadyAssigned.length > 0) {
      // Build detailed info for error message
      const detailedInfo = alreadyAssigned.map((booking) => {
        const studentNames = booking.students
          ?.map(
            (s) => `${s.studentFirstName || ""} ${s.studentLastName || ""}`.trim()
          )
          .filter(Boolean)
          .join(", ") || "N/A";

        const parentNames = booking.students
          ?.flatMap((s) =>
            s.parents?.map(
              (p) => `${p.parentFirstName || ""} ${p.parentLastName || ""}`.trim()
            ) || []
          )
          .filter(Boolean)
          .join(", ") || "N/A";

        return `Student(s): ${studentNames}; Parent(s): ${parentNames}`;
      });

      throw new Error(
        `Some bookings are already assigned: ${detailedInfo.join(" | ")}`
      );
    }

    // Bulk update bookings
    await Booking.update(
      {
        bookedBy,
        updatedAt: new Date(),
      },
      {
        where: {
          id: { [Op.in]: bookingIds },
        },
        transaction: t,
      }
    );

    await t.commit();

    return {
      status: true,
      message: "Bookings successfully assigned to agent",
      data: {
        bookingIds,
        bookedBy,
        totalAssigned: bookingIds.length,
      },
    };
  } catch (error) {
    await t.rollback();
    return {
      status: false,
      message: error.message,
    };
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
    if (filters.status) trialWhere.status = filters.status;

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
              "$classSchedule.venue.createdBy$": {
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
              "$classSchedule.venue.createdBy$": {
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
            { model: BookingParentMeta, as: "parents", required: false },
            {
              model: BookingEmergencyMeta,
              as: "emergencyContacts",
              required: false,
            },
          ],
          required: false,
        },
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: !!filters.venueName, // ✅ make required if searching by venueName
          include: [
            {
              model: Venue,
              as: "venue",
              where: filters.venueName
                ? { name: { [Op.like]: `%${filters.venueName}%` } }
                : undefined,
              required: !!filters.venueName, // ✅ same here
            },
          ],
        },
        {
          model: Admin, // 👈 include bookedBy Admin
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
          ],
          required: false,
        },
      ],
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

        let paymentPlans = [];
        const venue = booking?.classSchedule?.venue;
        if (venue) {
          let paymentPlanIds = [];
          if (typeof venue.paymentPlanId === "string") {
            try {
              paymentPlanIds = JSON.parse(venue.paymentPlanId);
            } catch { }
          } else if (Array.isArray(venue.paymentPlanId)) {
            paymentPlanIds = venue.paymentPlanId;
          }
          paymentPlanIds = paymentPlanIds
            .map((id) => parseInt(id, 10))
            .filter(Boolean);

          if (paymentPlanIds.length) {
            paymentPlans = await PaymentPlan.findAll({
              where: { id: paymentPlanIds },
            });
          }
        }

        const { venue: _venue, ...bookingData } = booking.dataValues;

        return {
          ...bookingData,
          students,
          parents,
          emergency,
          classSchedule: booking.classSchedule || null,
          paymentPlans,
          venue: booking.classSchedule?.venue || null, // ✅ include venue per trial
          ...(booking.bookedByAdmin
            ? {
              [booking.bookedByAdmin.role?.name === "Admin"
                ? "bookedByAdmin"
                : booking.bookedByAdmin.role?.name === "Agent"
                  ? "bookedByAgent"
                  : "bookedByOther"]: booking.bookedByAdmin,
            }
            : { bookedBy: null }),
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
    const trialsToMembers = finalBookings.filter(b => b.isConvertedToMembership).length;
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
        {
          model: ClassSchedule,
          as: "classSchedule",
          required: false,
          include: [
            {
              model: Venue,
              as: "venue",
              required: false,
            },
          ],
        },
      ],
    });

    if (!booking) {
      return {
        status: false,
        message: "Booking not found or not authorized.",
      };
    }

    // Fetch payment plans
    let paymentPlans = [];
    const venue = booking?.classSchedule?.venue;
    if (venue) {
      let paymentPlanIds = [];

      if (typeof venue.paymentPlanId === "string") {
        try {
          paymentPlanIds = JSON.parse(venue.paymentPlanId);
        } catch {
          console.warn("⚠️ Failed to parse venue.paymentPlanId");
        }
      } else if (Array.isArray(venue.paymentPlanId)) {
        paymentPlanIds = venue.paymentPlanId;
      }

      paymentPlanIds = paymentPlanIds
        .map((id) => parseInt(id, 10))
        .filter(Boolean);

      if (paymentPlanIds.length) {
        paymentPlans = await PaymentPlan.findAll({
          where: { id: paymentPlanIds },
        });
      }
    }

    // Final Response — no .toJSON() and no field picking
    return {
      status: true,
      message: "Fetched booking details successfully.",
      data: {
        ...booking.dataValues, // includes all booking fields
        students: booking.students || [],
        classSchedule: booking.classSchedule || null, // full object
        paymentPlans,
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

// exports.getAllBookings = async (adminId, filters = {}) => {
//   try {
//     const trialWhere = {};
//     const venueWhere = {};

//     if (filters.venueId) trialWhere.venueId = filters.venueId;
//     if (filters.trialDate) trialWhere.trialDate = filters.trialDate;
//     if (filters.status) trialWhere.status = filters.status;
//     if (filters.dateBooked) {
//       const start = new Date(filters.dateBooked + " 00:00:00");
//       const end = new Date(filters.dateBooked + " 23:59:59");
//       trialWhere.createdAt = { [Op.between]: [start, end] };
//     }
//     if (filters.venueName) {
//       venueWhere.name = { [Op.like]: `%${filters.venueName}%` };
//     }
//     if (filters.sourceAgentName) {
//       trialWhere.source = { [Op.like]: `%Agent(${filters.sourceAgentName})%` };
//     }
//     // 🔹 Existing special agent source filter
//     if (filters.sourceAgentName) {
//       trialWhere.source = { [Op.like]: `%Agent(${filters.sourceAgentName})%` };
//     }

//     // 🔹 NEW generic source filter
//     if (filters.source) {
//       trialWhere.source = { [Op.like]: `%${filters.source}%` };
//     }
//     const bookings = await Booking.findAll({
//       order: [["id", "DESC"]],
//       where: trialWhere,
//       include: [
//         {
//           model: BookingStudentMeta,
//           as: "students",
//           include: [
//             { model: BookingParentMeta, as: "parents", required: false },
//             {
//               model: BookingEmergencyMeta,
//               as: "emergencyContacts",
//               required: false,
//             },
//           ],
//           required: false,
//         },
//         {
//           model: ClassSchedule,
//           as: "classSchedule",
//           required: false,
//           include: [
//             {
//               model: Venue,
//               as: "venue",
//               where: venueWhere,
//               required: false,
//             },
//           ],
//         },
//       ],
//     });

//     const parsedBookings = await Promise.all(
//       bookings.map(async (booking) => {
//         const students =
//           booking.students?.map((s) => ({
//             studentFirstName: s.studentFirstName,
//             studentLastName: s.studentLastName,
//             dateOfBirth: s.dateOfBirth,
//             age: s.age,
//             gender: s.gender,
//             medicalInformation: s.medicalInformation,
//           })) || [];

//         const parents =
//           booking.students?.[0]?.parents?.map((p) => ({
//             parentFirstName: p.parentFirstName,
//             parentLastName: p.parentLastName,
//             parentEmail: p.parentEmail,
//             parentPhoneNumber: p.parentPhoneNumber,
//             relationToChild: p.relationToChild,
//             howDidYouHear: p.howDidYouHear,
//           })) || [];

//         const emergency =
//           booking.students?.[0]?.emergencyContacts?.map((e) => ({
//             emergencyFirstName: e.emergencyFirstName,
//             emergencyLastName: e.emergencyLastName,
//             emergencyPhoneNumber: e.emergencyPhoneNumber,
//             emergencyRelation: e.emergencyRelation,
//           })) || [];

//         // 🟢 Fetch payment plans just like getBookingById
//         let paymentPlans = [];
//         const venue = booking?.classSchedule?.venue;
//         if (venue) {
//           let paymentPlanIds = [];

//           if (typeof venue.paymentPlanId === "string") {
//             try {
//               paymentPlanIds = JSON.parse(venue.paymentPlanId);
//             } catch {
//               console.warn("⚠️ Failed to parse venue.paymentPlanId");
//             }
//           } else if (Array.isArray(venue.paymentPlanId)) {
//             paymentPlanIds = venue.paymentPlanId;
//           }

//           paymentPlanIds = paymentPlanIds
//             .map((id) => parseInt(id, 10))
//             .filter(Boolean);

//           if (paymentPlanIds.length) {
//             paymentPlans = await PaymentPlan.findAll({
//               where: { id: paymentPlanIds },
//             });
//           }
//         }

//         return {
//           ...booking.dataValues, // Keep all booking fields
//           students,
//           parents,
//           emergency,
//           classSchedule: booking.classSchedule || null,
//           paymentPlans,
//         };
//       })
//     );

//     let finalBookings = parsedBookings;
//     if (filters.studentName) {
//       const keyword = filters.studentName.toLowerCase();
//       finalBookings = parsedBookings.filter((booking) =>
//         booking.students.some(
//           (s) =>
//             s.studentFirstName?.toLowerCase().includes(keyword) ||
//             s.studentLastName?.toLowerCase().includes(keyword)
//         )
//       );
//     }

//     return {
//       status: true,
//       data: finalBookings,
//       totalFreeTrials: finalBookings.length,
//     };
//   } catch (error) {
//     console.error("❌ getAllBookings Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };
