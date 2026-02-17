const AccountInformationService = require("../../../services/admin/accountInformations/accountInformation");
const { logActivity } = require("../../../utils/admin/activityLogger");
const oneToOneLeadService = require("../../../services/admin/oneToOne//oneToOneLeadsService");
const birthdayPartyLeadService = require("../../../services/admin/birthdayParty/birthdayPartyLeadsService");
const freeTrialBookingService = require("../../../services/admin/booking/bookingTrial");
const holidayBookingService = require("../../../services/admin/holidayCamps/booking/holidayBooking");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");
const { getMainSuperAdminOfAdmin } = require("../../../utils/auth");

const {
  sequelize, BirthdayPartyBooking
} = require("../../../models");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "account_information";

exports.getBookingById = async (req, res) => {
  try {
    if (DEBUG) console.log("🔎 [STEP 0] getBookingById called");

    const bookingId = req.params.id;
    const adminId = req.admin.id;
    const requestedServiceType = req.body?.serviceType?.toLowerCase();

    if (DEBUG) {
      console.log("📥 [STEP 0] bookingId:", bookingId);
      console.log("👤 [STEP 0] adminId:", adminId);
      console.log("🧪 [STEP 0] requestedServiceType:", requestedServiceType);
    }

    if (!bookingId) {
      return res.status(400).json({
        status: false,
        message: "bookingId is required",
      });
    }

    // 🔐 Resolve super admin
    if (DEBUG) console.log("🔐 [STEP 1] Resolving super admin");

    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(adminId, true);
    const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? adminId;

    if (DEBUG) {
      console.log("👑 [STEP 1] superAdminId:", superAdminId);
    }

    // 🎂 STEP 2 — BIRTHDAY PARTY (BY BOOKING ID)
    if (requestedServiceType === "birthday party") {
      if (DEBUG)
        console.log("🎂 [STEP 2] Fetching Birthday Party booking via bookingId");

      // 1️⃣ Find booking → get leadId
      const booking = await BirthdayPartyBooking.findOne({
        where: { leadId: bookingId }, // ✅ FIX
        attributes: ["id", "leadId"],
      });

      if (!booking || !booking.leadId) {
        return res.status(404).json({
          status: false,
          message: "Birthday Party booking not found.",
        });
      }

      // 2️⃣ Fetch lead using leadId
      const birthdayResult =
        await birthdayPartyLeadService.getBirthdayPartyLeadsById(
          booking.leadId,     // ✅ leadId
          adminId,
          superAdminId
        );

      if (!birthdayResult.status) {
        return res.status(404).json({
          status: false,
          message: birthdayResult.message,
        });
      }

      return res.status(200).json({
        status: true,
        message: "Birthday Party booking fetched successfully",
        data: birthdayResult.data,
      });
    }

    // 🟢 STEP 3 — ONE-TO-ONE
    if (requestedServiceType === "one to one") {
      if (DEBUG)
        console.log("🟢 [STEP 3] One-to-One flow started");

      const oneToOneResult =
        await oneToOneLeadService.getOnetoOneLeadsById(
          bookingId,       // ✅ leadId
          superAdminId,
          adminId
        );

      if (DEBUG)
        console.log("📦 [STEP 3] One-to-One result:", oneToOneResult);

      if (!oneToOneResult.status) {
        return res.status(404).json({
          status: false,
          message: oneToOneResult.message,
        });
      }

      return res.status(200).json({
        status: true,
        message: "One-to-One booking fetched successfully",
        data: oneToOneResult.data,
      });
    }
    // 🟣 STEP 5 — HOLIDAY CAMP (BOOKING-BASED ✅)
    if (requestedServiceType === "holiday camp") {
      if (DEBUG) console.log("🟣 [STEP 4] Holiday Camp flow");

      const holidayResult =
        await holidayBookingService.getBookingById(
          bookingId,     // ✅ bookingId
          superAdminId,
          adminId
        );

      if (DEBUG)
        console.log("📦 [STEP 4] Holiday Camp result:", holidayResult);

      if (!holidayResult.success) {
        return res.status(404).json({
          status: false,
          message: holidayResult.message,
        });
      }

      return res.status(200).json({
        status: true,
        message: "Holiday Camp booking fetched successfully",
        data: holidayResult.data,
        summary: holidayResult.summary,
      });
    }
    if (requestedServiceType === "weekly class trial") {
      if (DEBUG) console.log("🟣 [STEP 4] Weekly Class Trial flow");

      const trialsResult =
        await freeTrialBookingService.getBookingById(
          bookingId,
          superAdminId // ✅ FIX
        );

      if (DEBUG)
        console.log("📦 [STEP 4] Trials result:", trialsResult);

      if (!trialsResult.status) {
        return res.status(404).json({
          status: false,
          message: trialsResult.message,
        });
      }

      return res.status(200).json({
        status: true,
        message: "Trials booking fetched successfully",
        data: trialsResult.data,
      });
    }

    // 🧾 STEP 4 — DEFAULT MEMBERSHIP FLOW
    if (DEBUG)
      console.log("📦 [STEP 3] Fetching AccountInformation for membership");

    const result =
      await AccountInformationService.getStudentByBookingId(bookingId);

    if (DEBUG)
      console.log("📦 [STEP 3] AccountInformation result:", result);

    if (!result.status) {
      return res.status(404).json({
        status: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      status: true,
      message: "Membership data fetched successfully",
      data: result.data.accountInformation,
    });

  } catch (error) {
    console.error("❌ [FATAL] getBookingById Error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};

//  Listing
exports.getAllStudentsListing = async (req, res) => {
  try {
    // 🧾 Extract filters from query params
    const filters = {
      studentName: req.query.studentName || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      status: req.query.status || null,
      venueId: req.query.venueId || null,
    };

    const adminId = req.admin?.id;
    const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id, true);
    const superAdminId = mainSuperAdminResult?.superAdmin.id ?? null;

    // ✅ Apply bookedBy filter
    if (req.admin?.role?.toLowerCase() === "super admin") {

      const childAdminIds = (mainSuperAdminResult?.admins || [])
        .map(a => a.id);

      filters.bookedBy = [
        req.admin.id,        // ✅ Super Admin data
        ...childAdminIds,    // ✅ Child admins data
      ];

    } else {
      filters.bookedBy = req.admin.id;
    }

    // 🧠 Run all three service calls in parallel for performance
    const [membershipResult, trialsResult, oneToOneResult, birthdayPartyResult, holidayBookingResult] = await Promise.all([
      AccountInformationService.getAllStudentsListing(filters),
      freeTrialBookingService.getAllBookings(filters),
      oneToOneLeadService.getAllOnetoOneLeadsSales(superAdminId, adminId, filters),
      birthdayPartyLeadService.getAllBirthdayPartyLeadsSales(superAdminId, adminId, filters),
      holidayBookingService.getHolidayBooking(superAdminId, adminId),
    ]);
    console.log("membershipResult:", membershipResult);
    console.log("trialsResult:", trialsResult);
    console.log("oneToOneResult:", oneToOneResult);
    console.log("birthdayPartyResult:", birthdayPartyResult);
    console.log("holidayBookingResult:", holidayBookingResult);

    // ❌ Handle Membership failure
    if (!membershipResult.status) {
      await logActivity(req, PANEL, MODULE, "read", { filters, error: membershipResult.message }, false);
      return res.status(500).json({
        status: false,
        message: membershipResult.message || "Failed to retrieve student listings",
      });
    }
    // ❌ Handle Trials failure
    if (!trialsResult.status) {
      await logActivity(req, PANEL, MODULE, "read", { filters, error: trialsResult.message }, false);
      return res.status(500).json({
        status: false,
        message: trialsResult.message || "Failed to retrieve trials listings",
      });
    }

    // ❌ Handle One-to-One failure
    if (!oneToOneResult.status) {
      await logActivity(req, PANEL, MODULE, "read", { filters, error: oneToOneResult.message }, false);
      return res.status(500).json({
        status: false,
        message: oneToOneResult.message || "Failed to retrieve One-to-One leads",
      });
    }

    // ❌ Handle Birthday Party failure
    if (!birthdayPartyResult.status) {
      await logActivity(req, PANEL, MODULE, "read", { filters, error: birthdayPartyResult.message }, false);
      return res.status(500).json({
        status: false,
        message: birthdayPartyResult.message || "Failed to retrieve Birthday Party leads",
      });
    }
    // ❌ Handle Holiday Booking Party failure
    if (!holidayBookingResult.status) {
      await logActivity(req, PANEL, MODULE, "read", { filters, error: holidayBookingResult.message }, false);
      return res.status(500).json({
        status: false,
        message: holidayBookingResult.message || "Failed to retrieve Holiday Booking data",
      });
    }

    // 🧩 Optional: Debug logging
    if (DEBUG) {
      console.log("DEBUG: Membership data:", JSON.stringify(membershipResult.data, null, 2));
      console.log("DEBUG: Trials data:", JSON.stringify(trialsResult.data, null, 2));
      console.log("DEBUG: One-to-One data:", JSON.stringify(oneToOneResult.data, null, 2));
      console.log("DEBUG: Birthday Party data:", JSON.stringify(birthdayPartyResult.data, null, 2));
      console.log("DEBUG: Holiday Booking data:", JSON.stringify(holidayBookingResult.data, null, 2));

    }

    // ✅ Combine results into unified structure
    const unifiedData = {
      accountInformation: {
        membership: membershipResult?.data?.accountInformation || [],
        trials: trialsResult?.data?.trials || [],
        oneToOne: oneToOneResult?.data || [],
        birthdayParty: birthdayPartyResult?.data || [],
        holidayCamps: holidayBookingResult?.data || [],
      },
    };

    // ✅ Log successful read
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      {
        filters,
        membershipCount: membershipResult.data?.accountInformation?.length || 0,
        trialsCount: trialsResult?.data?.trials?.length || 0,
        oneToOneCount: oneToOneResult.data?.length || 0,
        birthdayPartyCount: birthdayPartyResult.data?.length || 0,
        holidayCampCount: holidayBookingResult?.data?.length || 0,
      },
      true
    );

    // ✅ Return unified formatted response
    return res.status(200).json({
      status: true,
      message: "Bookings retrieved successfully",
      data: unifiedData,
    });
  } catch (error) {
    console.error("❌ getAllStudentsListing Controller Error:", error.message);

    // 🧾 Log and respond with server error
    await logActivity(req, PANEL, MODULE, "read", { error: error.message }, false);

    return res.status(500).json({
      status: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.updateBooking = async (req, res) => {
  if (DEBUG) console.log("🔹 Step 0: Controller entered");

  const bookingId = req.params?.bookingId;
  const studentsPayload = req.body?.students || [];
  const parentsPayload = req.body?.parents || [];
  const emergenciesPayload = req.body?.emergencyContacts || [];
  const adminId = req.admin?.id;

  // ✅ Security check
  if (!adminId) {
    if (DEBUG) console.warn("❌ Unauthorized access attempt");
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }

  if (!bookingId) {
    if (DEBUG) console.warn("❌ Booking ID missing in URL");
    return res.status(400).json({
      status: false,
      message: "Booking ID is required in URL (params.bookingId).",
    });
  }

  const t = await sequelize.transaction();

  try {
    if (DEBUG) console.log("🔹 Step 1: Calling service to update booking + students");

    // Call service
    const updateResult = await AccountInformationService.updateBookingWithStudents(
      bookingId,
      { students: studentsPayload, parents: parentsPayload, emergencyContacts: emergenciesPayload },
      t
    );

    await t.commit();
    if (DEBUG) console.log("✅ Step 2: Transaction committed successfully");

    // Log activity
    if (DEBUG) console.log("🔹 Step 3: Logging activity");
    await logActivity(
      req,
      "admin",
      "book-membership",
      "update",
      { message: `Updated student, parent, and emergency data for booking ID: ${bookingId}` },
      true
    );

    // Create notification
    if (DEBUG) console.log("🔹 Step 4: Creating notification");
    await createNotification(
      req,
      "Booking Updated",
      `Student, parent, and emergency data updated for booking ID: ${bookingId}.`,
      "System"
    );

    if (DEBUG) console.log("✅ Step 5: Controller finished successfully");

    return res.status(200).json({
      status: updateResult.status,
      message: updateResult.message,
      data: updateResult.data || null,
    });

  } catch (error) {
    if (!t.finished) await t.rollback();
    if (DEBUG) console.error("❌ updateBooking Error:", error.message);
    return res.status(500).json({
      status: false,
      message: error.message || "Failed to update booking",
    });
  }
};

exports.getVenuesWithClassesFromBookings = async (req, res) => {
  try {
    // 🔹 bookingId will now come from req.params
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({
        status: false,
        message: "bookingId is required",
      });
    }

    // 🔹 Pass bookingId to service
    const result =
      await AccountInformationService.getVenuesWithClassesFromBookings(
        bookingId
      );

    if (!result.status) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "read",
        { error: result.message, bookingId },
        false
      );

      return res.status(404).json({
        status: false,
        message: result.message || "Failed to retrieve venue with classes",
      });
    }

    if (DEBUG) {
      console.log(
        "DEBUG: Retrieved venue with classes:",
        JSON.stringify(result.data, null, 2)
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { bookingId, venueCount: result.data.length },
      true
    );

    return res.status(200).json({
      status: true,
      message: "Venue with classes retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getVenuesWithClassesFromBookings Error:", error.message);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message, bookingId: req.params.bookingId || null },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};
