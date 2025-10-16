const AccountInformationService = require("../../../services/admin/accountInformations/accountInformation");
const { logActivity } = require("../../../utils/admin/activityLogger");
const {
  createNotification,
} = require("../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "account_information";

//  controller account information
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

    // 🧠 Call the service layer
    const result = await AccountInformationService.getAllStudentsListing(filters);

    // ❌ Handle service-level failure
    if (!result.status) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "read",
        { filters, error: result.message },
        false
      );
      return res.status(500).json({
        status: false,
        message: result.message || "Failed to retrieve student listings",
      });
    }

    // 🧩 Optional: Debug logging
    if (DEBUG) {
      console.log(
        "DEBUG: Retrieved student listing:",
        JSON.stringify(result.data, null, 2)
      );
    }

    // ✅ Log successful read
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { filters, count: result.data.accountInformation.length },
      true
    );

    // ✅ Return formatted response
    return res.status(200).json({
      status: true,
      message: "Bookings retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getAllStudentsListing Controller Error:", error.message);

    // 🧾 Log and respond with server error
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.getStudentById = async (req, res) => {
  try {
    const studentId = req.params.id;

    const result = await AccountInformationService.getStudentById(studentId);

    if (!result.status) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "read",
        { studentId, error: result.message },
        false
      );
      return res.status(404).json({ status: false, message: result.message });
    }

    if (DEBUG) {
      console.log(
        "DEBUG: Retrieved student by ID:",
        JSON.stringify(result.data, null, 2)
      );
    }

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { studentId, count: result.data.accountInformation.students.length },
      true
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ getStudentById Error:", error.message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.updateBookingInformationByTrialId = async (req, res) => {
  try {
    const { bookingTrialId, ...updateData } = req.body;

    if (!bookingTrialId) {
      return res.status(400).json({
        status: false,
        message: "bookingTrialId is required in request body",
      });
    }

    if (process.env.DEBUG) {
      console.log("DEBUG: bookingTrialId:", bookingTrialId);
    }

    const result =
      await AccountInformationService.updateBookingInformationByTrialId(
        bookingTrialId,
        updateData
      );

    if (!result.status) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "update",
        { bookingTrialId, error: result.message },
        false
      );
      return res.status(400).json({ status: false, message: result.message });
    }

    if (DEBUG) {
      console.log("DEBUG: Updated bookingTrialId:", bookingTrialId);
    }
    await createNotification(
      req,
      "Account Information Updated",
      "System"
    );
    await logActivity(req, PANEL, MODULE, "update", { bookingTrialId }, true);

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ updateBookingTrial Error:", error.message);
    await logActivity(
      req,
      PANEL,
      MODULE,
      "update",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getBookingsById = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { type, fromDate, toDate } = req.query;

    // 🧾 Validate input
    if (!bookingId) {
      return res.status(400).json({
        status: false,
        message: "Booking ID is required",
      });
    }

    // 🔎 Call service with filters
    const result = await AccountInformationService.getBookingsById(bookingId, {
      type,
      fromDate,
      toDate,
    });

    // ❌ Handle service failure
    if (!result.status) {
      await logActivity(
        req,
        PANEL,
        MODULE,
        "read",
        { bookingId, error: result.message },
        false
      );

      return res.status(404).json({
        status: false,
        message: result.message || "Booking not found",
      });
    }

    // 🧩 Optional Debug Logging
    if (DEBUG) {
      console.log(
        "DEBUG: Retrieved booking info:",
        JSON.stringify(result.data, null, 2)
      );
    }

    // ✅ Log successful retrieval
    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { bookingId },
      true
    );

    // ✅ Send successful response
    return res.status(200).json({
      status: true,
      message: "Booking retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getBookingsById Controller Error:", error.message);

    await logActivity(
      req,
      PANEL,
      MODULE,
      "read",
      { error: error.message },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error. Please try again later.",
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

exports.createFeedback = async (req, res) => {
  try {
    const feedbackData = req.body;

    // 🔹 Step 1: Call service to create feedback
    const result = await AccountInformationService.createFeedbackById(
      feedbackData
    );

    // 🔹 Step 2: Handle failure
    if (!result.status) {
      await logActivity(
        req,
        PANEL,
        "feedback",
        "create",
        { error: result.message, feedbackData },
        false
      );

      return res.status(400).json(result);
    }

    // 🔹 Step 3: DEBUG logs
    if (DEBUG) {
      console.log(
        "DEBUG: Feedback created:",
        JSON.stringify(result.data, null, 2)
      );
    }

    // 🔹 Step 4: Log success activity
    await logActivity(
      req,
      PANEL,
      "feedback",
      "create",
      { feedbackId: result.data.id, feedbackData },
      true
    );

    // 🔹 Step 5: Create notification (Admins or assigned agent)
    if (feedbackData.agentAssigned) {
      await createNotification(
        req,
        "New Feedback Assigned",
        `You have been assigned to handle a new feedback submission. Please review the details and take the necessary action promptly.`,
        "System" // or dynamically set role if needed
      );
    }

    return res.status(201).json({
      status: true,
      message: "Feedback created successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ createFeedback Error:", error.message);

    await logActivity(
      req,
      PANEL,
      "feedback",
      "create",
      { error: error.message, feedbackData: req.body },
      false
    );

    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};

exports.listAllFeedbacks = async (req, res) => {
  try {
    const { bookingId } = req.query; // ✅ optional query param
    console.log("🔹 Step 1: Calling service to list feedbacks...", {
      bookingId,
    });

    const result = await AccountInformationService.listAllFeedbacks(bookingId);

    console.log("🔹 Step 2: Service call completed");

    if (!result.status) {
      console.log("❌ Step 3: Service returned failure:", result.message);
      await logActivity(
        req,
        PANEL,
        "feedback",
        "read",
        { error: result.message },
        false
      );
      return res.status(400).json(result);
    }

    if (DEBUG) {
      console.log(
        "🔹 Step 4: DEBUG: Retrieved feedbacks:",
        JSON.stringify(result.data, null, 2)
      );
    }

    console.log(
      `🔹 Step 5: Logging success activity for ${result.data.length} feedback(s)`
    );
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read",
      { feedbackCount: result.data.length },
      true
    );

    console.log("✅ Step 6: Returning response to client");
    return res.status(200).json({
      status: true,
      message: "All feedbacks retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ listAllFeedbacks Controller Error:", error.message);
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getFeedbackById = async (req, res) => {
  try {
    const { id } = req.params; // ✅ feedbackId comes from route param
    console.log("🔹 Step 1: Calling service to get feedback by id...", { id });

    const result = await AccountInformationService.getFeedbackById(id);

    console.log("🔹 Step 2: Service call completed");

    if (!result.status) {
      console.log("❌ Step 3: Service returned failure:", result.message);
      await logActivity(
        req,
        PANEL,
        "feedback",
        "read-single",
        { error: result.message, feedbackId: id },
        false
      );
      return res.status(404).json(result);
    }

    if (DEBUG) {
      console.log(
        "🔹 Step 4: DEBUG: Retrieved feedback:",
        JSON.stringify(result.data, null, 2)
      );
    }

    console.log("🔹 Step 5: Logging success activity for feedback", id);
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read-single",
      { feedbackId: id },
      true
    );

    console.log("✅ Step 6: Returning response to client");
    return res.status(200).json({
      status: true,
      message: "Feedback retrieved successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getFeedbackById Controller Error:", error.message);
    await logActivity(
      req,
      PANEL,
      "feedback",
      "read-single",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
exports.resolveFeedback = async (req, res) => {
  try {
    const { feedbackId } = req.params; // feedbackId from route
    console.log("🔹 Step 1: Resolving feedback...", { feedbackId });

    const result = await AccountInformationService.updateFeedbackStatus(
      feedbackId,
      "resolved"
    );

    if (!result.status) {
      await logActivity(
        req,
        PANEL,
        "feedback",
        "update-status",
        { error: result.message, feedbackId },
        false
      );
      return res.status(404).json(result);
    }

    await logActivity(
      req,
      PANEL,
      "feedback",
      "update-status",
      { feedbackId, newStatus: "resolved" },
      true
    );

    console.log("✅ Step 2: Returning response to client");
    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ resolveFeedback Controller Error:", error.message);
    await logActivity(
      req,
      PANEL,
      "feedback",
      "update-status",
      { error: error.message },
      false
    );
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

// com

exports.getEventsByBookingId = async (req, res) => {
  try {
    const { bookingId } = req.params;

    console.log(`📌 Controller: Fetching events for bookingId=${bookingId}`);

    const result = await AccountInformationService.getEventsByBookingId(
      bookingId
    );

    if (!result.status) {
      return res.status(404).json({
        status: false,
        message: result.message,
        data: result.data || [],
      });
    }

    return res.status(200).json({
      status: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ getEventsByBookingId Controller Error:", error.message);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch events",
      error: error.message,
    });
  }
};
