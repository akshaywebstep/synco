const {
  sequelize,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  BookingPayment,
  ClassSchedule,
  Venue,
  PaymentPlan,
  Admin,
  CancelBooking,
} = require("../../../models");
const axios = require("axios");
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
const DEBUG = process.env.DEBUG === "true";

exports.createBooking = async (data, options) => {
  const t = await sequelize.transaction();
  try {
    const bookedBy = options?.adminId || null;

    // 🔹 Step 1: Create Booking
    const booking = await Booking.create(
      {
        venueId: data.venueId,
        bookingId: generateBookingId(12),
        totalStudents: data.totalStudents,
        classScheduleId: data.classScheduleId,
        startDate: data.startDate || null,
        keyInformation: data.keyInformation || null,
        bookingType: data.paymentPlanId ? "paid" : "free",
        paymentPlanId: data.paymentPlanId || null,
        status: data.status || "active",
        bookedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction: t }
    );

    // 🔹 Step 2: Create Students
    const studentRecords = [];
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
      studentRecords.push(studentMeta);
    }

    // 🔹 Step 3: Create Parents
    if (data.parents?.length && studentRecords.length) {
      const firstStudent = studentRecords[0];

      for (const parent of data.parents) {
        const email = parent.parentEmail?.trim()?.toLowerCase();
        if (!email) throw new Error("Parent email is required.");

        // Check for existing parent in BookingParentMeta for this student
        const existingParent = await BookingParentMeta.findOne({
          where: { studentId: firstStudent.id, parentEmail: email },
          transaction: t,
        });

        // Check for existing email in Admin table
        const existingAdmin = await Admin.findOne({
          where: { email },
          transaction: t,
        });

        if (existingParent || existingAdmin) {
          throw new Error(
            `Parent with email ${email} already exists in the system.`
          );
        }

        // If no duplicates, create parent
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

        // Create admin entry
        await Admin.create(
          {
            firstName: parent.parentFirstName || "Parent",
            lastName: parent.parentLastName || "",
            phoneNumber: parent.parentPhoneNumber || "",
            email,
            password: await bcrypt.hash("Synco123", 10),
            roleId: 9,
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );
      }
    }

    // 🔹 Step 4: Emergency Contact
    if (
      data.emergency?.emergencyFirstName &&
      data.emergency?.emergencyPhoneNumber &&
      studentRecords.length
    ) {
      const firstStudent = studentRecords[0];
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

    // 🔹 Step 5: Process Payment if booking has a payment plan
    if (booking.paymentPlanId && data.payment?.paymentType) {
      const paymentType = data.payment.paymentType; // "rrn" or "card"
      console.log("Step 5: Start payment process, paymentType:", paymentType);

      let paymentStatusFromGateway = "pending";
      const firstStudentId = studentRecords[0]?.id;

      try {
        // Fetch payment plan & pricing
        const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
          transaction: t,
        });
        if (!paymentPlan) throw new Error("Invalid payment plan selected.");
        const price = paymentPlan.price || 0;

        // Fetch venue & classSchedule info
        const venue = await Venue.findByPk(data.venueId, { transaction: t });
        const classSchedule = await ClassSchedule.findByPk(
          data.classScheduleId,
          {
            transaction: t,
          }
        );

        const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
        let gatewayResponse = null;
        const amountInPence = Math.round(price * 100);

        if (paymentType === "rrn") {
          // 🔹 RRN payment using GoCardless
          if (!data.payment.referenceId)
            throw new Error("Reference ID is required for RRN payments.");

          const gcPayload = {
            cardHolderName: null, // <-- set to null
            cv2: null, // <-- set to null
            expiryDate: null, // <-- set to null
            pan: null, // <-- set to null
            billing_requests: {
              payment_request: {
                description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
                  }`,
                amount: amountInPence,
                scheme: "faster_payments",
                currency: "GBP",
                metadata: { referenceId: data.payment.referenceId },
              },
              mandate_request: {
                currency: "GBP",
                scheme: "bacs",
                verify: "recommended",
                metadata: { referenceId: data.payment.referenceId },
              },
              links: {},
              metadata: { test: `BR${Math.floor(Math.random() * 1000000)}` },
            },
          };

          console.log(
            "GoCardless payload:",
            JSON.stringify(gcPayload, null, 2)
          );

          const response = await axios.post(
            "https://api-sandbox.gocardless.com/billing_requests",
            gcPayload,
            {
              headers: {
                Authorization: `Bearer ${process.env.GOCARDLESS_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
                "GoCardless-Version": "2015-07-06",
              },
            }
          );

          gatewayResponse = response.data;
          // Extract status dynamically from GoCardless response
          paymentStatusFromGateway =
            gatewayResponse?.billing_requests?.status || "pending";
        } else if (paymentType === "card") {
          // 🔹 Card payment using Pay360
          if (
            !process.env.PAY360_INST_ID ||
            !process.env.PAY360_API_USERNAME ||
            !process.env.PAY360_API_PASSWORD
          )
            throw new Error("Pay360 credentials not set.");

          const paymentPayload = {
            transaction: {
              currency: "GBP",
              amount: price,
              merchantRef,
              description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
                }`,
              commerceType: "ECOM",
            },
            paymentMethod: {
              card: {
                pan: data.payment.pan,
                expiryDate: data.payment.expiryDate,
                cardHolderName: data.payment.cardHolderName,
                cv2: data.payment.cv2,
              },
            },
          };

          const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${process.env.PAY360_INST_ID}/payment`;
          const authHeader = Buffer.from(
            `${process.env.PAY360_API_USERNAME}:${process.env.PAY360_API_PASSWORD}`
          ).toString("base64");

          const response = await axios.post(url, paymentPayload, {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${authHeader}`,
            },
          });

          gatewayResponse = response.data;
          // Map status dynamically
          const txnStatus = gatewayResponse?.transaction?.status?.toLowerCase();
          if (txnStatus === "success") {
            paymentStatusFromGateway = "paid";
          } else if (txnStatus === "pending") {
            paymentStatusFromGateway = "pending";
          } else if (txnStatus === "declined") {
            paymentStatusFromGateway = "failed";
          } else {
            paymentStatusFromGateway = txnStatus || "unknown";
          }
        }

        // 🔹 Save BookingPayment (always save, even if failed)
        await BookingPayment.create(
          {
            bookingId: booking.id,
            paymentPlanId: booking.paymentPlanId,
            studentId: firstStudentId,
            paymentType,
            firstName:
              data.payment.firstName ||
              data.parents?.[0]?.parentFirstName ||
              "",
            lastName:
              data.payment.lastName || data.parents?.[0]?.parentLastName || "",
            email: data.payment.email || data.parents?.[0]?.parentEmail || "",
            billingAddress: data.payment.billingAddress || "",
            cardHolderName: data.payment.cardHolderName || "",
            cv2: data.payment.cv2 || "",
            expiryDate: data.payment.expiryDate || "",
            pan: data.payment.pan || "",
            referenceId: data.payment.referenceId || "",
            paymentStatus: paymentStatusFromGateway,
            currency:
              gatewayResponse?.transaction?.currency ||
              gatewayResponse?.billing_requests?.currency ||
              "GBP",
            merchantRef:
              gatewayResponse?.transaction?.merchantRef || merchantRef,
            description:
              gatewayResponse?.transaction?.description ||
              `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            commerceType: "ECOM",
            gatewayResponse,
            transactionMeta: {
              status:
                gatewayResponse?.transaction?.status ||
                gatewayResponse?.billing_requests?.status ||
                "unknown",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction: t }
        );

        console.log(
          `${paymentType.toUpperCase()} payment saved with status:`,
          paymentStatusFromGateway
        );

        // 🔹 Fail booking creation only if payment explicitly failed
        if (paymentStatusFromGateway === "failed") {
          throw new Error("Payment failed. Booking not created.");
        }
      } catch (err) {
        // 🔹 Proper error handling: only show readable message
        let errorMessage = "Payment failed";

        if (err.response?.data) {
          // Gateway returned an error
          if (typeof err.response.data === "string") {
            errorMessage = err.response.data;
          } else if (err.response.data.reasonMessage) {
            // Use reasonMessage from gateway response if available
            errorMessage = err.response.data.reasonMessage;
          } else if (err.response.data.error?.message) {
            // Use error.message if available
            errorMessage = err.response.data.error.message;
          } else {
            // Fallback: convert object to string safely
            errorMessage = Object.values(err.response.data).join(" | ");
          }
        } else if (err.message) {
          // Standard JS error
          errorMessage = err.message;
        }

        // Rollback transaction
        await t.rollback();

        // Return clean error message
        return {
          status: false,
          message: errorMessage,
        };
      }
    }

    // 🔹 Step 6: Update Class Capacity
    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
      transaction: t,
    });
    const newCapacity = classSchedule.capacity - data.totalStudents;
    if (newCapacity < 0) throw new Error("Not enough capacity left.");
    await classSchedule.update({ capacity: newCapacity }, { transaction: t });

    await t.commit();
    return {
      status: true,
      data: {
        bookingId: booking.bookingId,
        booking,
        studentId: studentRecords[0]?.id,
        studentFirstName: studentRecords[0]?.studentFirstName,
        studentLastName: studentRecords[0]?.studentLastName,
      },
    };
  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

exports.getAllBookingsWithStats = async (filters = {}) => {
  try {
    // const whereBooking = { bookingType: "paid" };
    const whereBooking = {
      bookingType: {
        [Op.in]: ["paid", "waiting list"],
      },
      status: {
        [Op.in]: [
          "cancelled",
          "active",
          "frozen",
          "waiting list",
          "request_to_cancel",
        ], // only these statuses
      },
    };
    const whereVenue = {};

    // 🔹 Filters
    if (filters.status) whereBooking.status = filters.status;
    if (filters.venueId) whereBooking.venueId = filters.venueId;
    if (filters.venueName)
      whereVenue.name = { [Op.like]: `%${filters.venueName}%` };
    if (filters.bookedBy) whereBooking.bookedBy = filters.bookedBy;
    if (filters.duration) {
      whereBooking["$paymentPlan.duration$"] = {
        [Op.like]: `%${filters.duration}%`,
      };
    }

    // ✅ Date filters
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom && filters.dateTo) {
      const start = new Date(filters.dateFrom + " 00:00:00");
      const end = new Date(filters.dateTo + " 23:59:59");
      whereBooking.startDate = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      whereBooking.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.lte]: end };
    }

    const bookings = await Booking.findAll({
      where: whereBooking,
      order: [["id", "DESC"]],
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
          required: false,
          include: [
            {
              model: Venue,
              as: "venue",
              where: whereVenue,
              required: !!filters.venueName,
            },
          ],
        },
        { model: BookingPayment, as: "payments", required: false },
        { model: PaymentPlan, as: "paymentPlan", required: false },
        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
            "profile",
          ],
          required: false,
        },
      ],
    });

    const parsedBookings = await Promise.all(
      bookings.map(async (booking) => {
        // Students
        const students =
          booking.students?.map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          })) || [];

        // Parents (flatten all student parents)
        const parents =
          booking.students?.flatMap(
            (s) =>
              s.parents?.map((p) => ({
                parentFirstName: p.parentFirstName,
                parentLastName: p.parentLastName,
                parentEmail: p.parentEmail,
                parentPhoneNumber: p.parentPhoneNumber,
                relationToChild: p.relationToChild,
                howDidYouHear: p.howDidYouHear,
              })) || []
          ) || [];

        // Emergency contacts (take first one per student)
        // ✅ Pick only the first student's emergency contacts
        const emergency =
          booking.students?.[0]?.emergencyContacts?.map((e) => ({
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || [];

        // Venue & plan
        const venue = booking.classSchedule?.venue || null;
        const plan = booking.paymentPlan || null;

        const payment = booking.payments?.[0] || null;
        const paymentPlans = plan ? [plan] : [];

        // PaymentData with parsed gatewayResponse & transactionMeta
        let parsedGatewayResponse = {};
        let parsedTransactionMeta = {};

        try {
          if (payment?.gatewayResponse) {
            parsedGatewayResponse =
              typeof payment.gatewayResponse === "string"
                ? JSON.parse(payment.gatewayResponse)
                : payment.gatewayResponse;
          }
        } catch (e) {
          console.error("Invalid gatewayResponse JSON", e);
        }

        try {
          if (payment?.transactionMeta) {
            parsedTransactionMeta =
              typeof payment.transactionMeta === "string"
                ? JSON.parse(payment.transactionMeta)
                : payment.transactionMeta;
          }
        } catch (e) {
          console.error("Invalid transactionMeta JSON", e);
        }

        const paymentData = payment
          ? {
            id: payment.id,
            bookingId: payment.bookingId,
            firstName: payment.firstName,
            lastName: payment.lastName,
            email: payment.email,
            billingAddress: payment.billingAddress,
            cardHolderName: payment.cardHolderName,
            cv2: payment.cv2,
            expiryDate: payment.expiryDate,
            paymentType: payment.paymentType,
            pan: payment.pan,
            paymentStatus: payment.paymentStatus,
            referenceId: payment.referenceId,
            currency: payment.currency,
            merchantRef: payment.merchantRef,
            description: payment.description,
            commerceType: payment.commerceType,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
            gatewayResponse: parsedGatewayResponse,
            transactionMeta: parsedTransactionMeta,
            totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
          }
          : null;

        const { venue: _venue, ...bookingData } = booking.dataValues;

        return {
          ...bookingData,
          students,
          parents,
          emergency,
          classSchedule: booking.classSchedule || null,
          // payments: booking.payments || [],
          paymentPlan: booking.paymentPlan || null,
          paymentPlans,
          venue,
          paymentData,
          bookedByAdmin: booking.bookedByAdmin || null,
        };
      })
    );

    // Student filter
    let finalBookings = parsedBookings;
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase();
      finalBookings = finalBookings
        .map((b) => {
          const matchedStudents = b.students.filter(
            (s) =>
              s.studentFirstName?.toLowerCase().includes(keyword) ||
              s.studentLastName?.toLowerCase().includes(keyword)
          );

          if (matchedStudents.length > 0) {
            return {
              ...b,
              // ✅ Always keep students as an array
              students:
                matchedStudents.length === 1
                  ? [matchedStudents[0]]
                  : matchedStudents,
            };
          }
          return null;
        })
        .filter(Boolean);

      if (finalBookings.length === 0) {
        return {
          status: true,
          message: "No bookings found for the student.",
          totalPaidBookings: 0,
          data: { membership: [], venue: [], bookedByAdmins: [] },
          stats: {
            totalStudents: 0,
            totalRevenue: 0,
            avgMonthlyFee: 0,
            avgLifeCycle: 0,
          },
        };
      }
    }

    // Venue filter
    if (filters.venueName) {
      const keyword = filters.venueName.toLowerCase();
      finalBookings = finalBookings.filter((b) =>
        b.venue?.name?.toLowerCase().includes(keyword)
      );
      if (finalBookings.length === 0) {
        return {
          status: true,
          message: "No bookings found for the venue.",
          totalPaidBookings: 0,
          data: { membership: [], venue: [], bookedByAdmins: [] },
          stats: {
            totalStudents: 0,
            totalRevenue: 0,
            avgMonthlyFee: 0,
            avgLifeCycle: 0,
          },
        };
      }
    }

    // Collect unique venues
    const venueMap = {};
    bookings.forEach((b) => {
      if (b.classSchedule?.venue) {
        venueMap[b.classSchedule.venue.id] = b.classSchedule.venue;
      }
    });
    const allVenues = Object.values(venueMap);

    // Collect unique bookedByAdmins
    const adminMap = {};
    bookings.forEach((b) => {
      if (b.bookedByAdmin) {
        adminMap[b.bookedByAdmin.id] = b.bookedByAdmin;
      }
    });
    const allAdmins = Object.values(adminMap);

    // Stats
    const totalStudents = finalBookings.reduce(
      (acc, b) => acc + (b.students?.length || 0),
      0
    );

    // ✅ Calculate revenue only from PaymentPlan (price + joiningFee) * student count
    const totalRevenue = finalBookings.reduce((acc, b) => {
      const plan = b.paymentPlans?.[0];
      if (plan?.price != null) {
        const studentsCount = b.students?.length || 1;
        return acc + (plan.price + (plan.joiningFee || 0)) * studentsCount;
      }
      return acc;
    }, 0);

    // ✅ Average monthly fee (spread over duration)
    const avgMonthlyFeeRaw =
      finalBookings.reduce((acc, b) => {
        const plan = b.paymentPlans?.[0];
        if (plan?.duration && plan.price != null) {
          const studentsCount = b.students?.length || 1;
          return (
            acc +
            ((plan.price + (plan.joiningFee || 0)) / plan.duration) *
            studentsCount
          );
        }
        return acc;
      }, 0) / (totalStudents || 1);

    // Round to 2 decimals (returns Number)
    const avgMonthlyFee = Math.round(avgMonthlyFeeRaw * 100) / 100;

    // ✅ Average lifecycle (duration * student count)
    const avgLifeCycle =
      finalBookings.reduce((acc, b) => {
        const plan = b.paymentPlans?.[0];
        if (plan?.duration != null) {
          const studentsCount = b.students?.length || 1;
          return acc + plan.duration * studentsCount;
        }
        return acc;
      }, 0) / (totalStudents || 1);
    // ✅ New: Fetch all venues from DB (including those with no bookings)
    const allVenuesFromDB = await Venue.findAll({
      order: [["name", "ASC"]],
      include: [
        {
          model: ClassSchedule,
          as: "classSchedules", // <-- make sure this matches your Sequelize association alias
          required: false, // include venues even if they have no classes
        },
      ],
    });

    return {
      status: true,
      message: "Paid bookings retrieved successfully",
      totalPaidBookings: finalBookings.length,
      data: {
        membership: finalBookings,
        venue: allVenues,
        bookedByAdmins: allAdmins, // ✅ unique list of admins like venues
        allVenues: allVenuesFromDB,
      },
      stats: { totalStudents, totalRevenue, avgMonthlyFee, avgLifeCycle },
    };
  } catch (error) {
    console.error("❌ getAllBookingsWithStats Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getActiveMembershipBookings = async (filters = {}) => {
  try {
    console.log("🔹 Service start: getActiveMembershipBookings");
    console.log("🔹 Filters received in service:", filters);

    // ✅ Default filter: active + paid bookings
    const whereBooking = { bookingType: "paid", status: "active" };
    const whereVenue = {};

    // 🔹 Apply filters
    if (filters.venueId) whereBooking.venueId = filters.venueId;
    if (filters.venueName) {
      whereVenue.name = { [Op.like]: `%${filters.venueName}%` };
    }
    if (filters.bookedBy) {
      whereBooking[Op.or] = [
        { "$admin.firstName$": { [Op.like]: `%${filters.bookedBy}%` } },
        { "$admin.lastName$": { [Op.like]: `%${filters.bookedBy}%` } },
      ];
    }
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    }
    if (filters.planType) {
      whereBooking["$paymentPlan.duration$"] = {
        [Op.like]: `%${filters.planType}%`,
      };
    }
    // if (filters.lifeCycle) {
    //   whereBooking["$paymentPlan.duration$"] = filters.lifeCycle;
    // }
    // if (filters.flexiPlan) {
    //   whereBooking["$paymentPlan.title$"] = filters.flexiPlan;
    // }
    if (filters.studentName) {
      const keyword = filters.studentName.toLowerCase();
      whereBooking[Op.or] = [
        { "$students.studentFirstName$": { [Op.like]: `%${keyword}%` } },
        { "$students.studentLastName$": { [Op.like]: `%${keyword}%` } },
      ];
    }
    // ✅ Date filters
    if (filters.dateBooked) {
      const start = new Date(filters.dateBooked + " 00:00:00");
      const end = new Date(filters.dateBooked + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.fromDate && filters.toDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.between]: [start, end] };
    } else if (filters.dateFrom && filters.dateTo) {
      const start = new Date(filters.dateFrom + " 00:00:00");
      const end = new Date(filters.dateTo + " 23:59:59");
      whereBooking.startDate = { [Op.between]: [start, end] };
    } else if (filters.fromDate) {
      const start = new Date(filters.fromDate + " 00:00:00");
      whereBooking.createdAt = { [Op.gte]: start };
    } else if (filters.toDate) {
      const end = new Date(filters.toDate + " 23:59:59");
      whereBooking.createdAt = { [Op.lte]: end };
    }

    console.log("🔹 whereBooking:", whereBooking);

    // 🔹 Fetch bookings
    const bookings = await Booking.findAll({
      where: whereBooking,
      order: [["id", "DESC"]],
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          required: true,
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
          include: [
            { model: Venue, as: "venue", where: whereVenue, required: true },
          ],
        },
        { model: BookingPayment, as: "payments", required: false },
        { model: PaymentPlan, as: "paymentPlan", required: false },
        { model: Admin, as: "admin", required: false },
      ],
    });

    console.log("🔹 Bookings fetched:", bookings.length);

    // 🔹 Map bookings to memberShipSales
    const memberShipSales = bookings.map((booking) => {
      const venue = booking.classSchedule?.venue || {};
      const payment = booking.payments?.[0] || {};
      const plan = booking.paymentPlan || null;

      // Students
      const students =
        booking.students?.map((student) => ({
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
        })) || [];

      // Parents
      const parents =
        booking.students?.flatMap(
          (student) =>
            student.parents?.map((parent) => ({
              parentFirstName: parent.parentFirstName,
              parentLastName: parent.parentLastName,
              parentEmail: parent.parentEmail,
              parentPhoneNumber: parent.parentPhoneNumber,
              relationToChild: parent.relationToChild,
              howDidYouHear: parent.howDidYouHear,
            })) || []
        ) || [];

      // Emergency
      const emergency =
        booking.students?.flatMap((student) =>
          student.emergencyContacts?.map((em) => ({
            emergencyFirstName: em.emergencyFirstName,
            emergencyLastName: em.emergencyLastName,
            emergencyPhoneNumber: em.emergencyPhoneNumber,
            emergencyRelation: em.emergencyRelation,
          }))
        )?.[0] || null;

      // Payment
      let parsedGatewayResponse = {};
      let parsedTransactionMeta = {};

      try {
        if (payment?.gatewayResponse) {
          parsedGatewayResponse =
            typeof payment.gatewayResponse === "string"
              ? JSON.parse(payment.gatewayResponse)
              : payment.gatewayResponse;
        }
      } catch (e) {
        console.error("Invalid gatewayResponse JSON", e);
      }

      try {
        if (payment?.transactionMeta) {
          parsedTransactionMeta =
            typeof payment.transactionMeta === "string"
              ? JSON.parse(payment.transactionMeta)
              : payment.transactionMeta;
        }
      } catch (e) {
        console.error("Invalid transactionMeta JSON", e);
      }

      // Combine all payment info into a fully structured object
      const paymentData = payment
        ? {
          id: payment.id,
          bookingId: payment.bookingId,
          firstName: payment.firstName,
          lastName: payment.lastName,
          email: payment.email,
          billingAddress: payment.billingAddress,
          cardHolderName: payment.cardHolderName,
          cv2: payment.cv2,
          expiryDate: payment.expiryDate,
          paymentType: payment.paymentType,
          pan: payment.pan,
          paymentStatus: payment.paymentStatus,
          referenceId: payment.referenceId,
          currency: payment.currency,
          merchantRef: payment.merchantRef,
          description: payment.description,
          commerceType: payment.commerceType,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          gatewayResponse: parsedGatewayResponse, // fully parsed JSON
          transactionMeta: parsedTransactionMeta, // fully parsed JSON
          totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
        }
        : null;

      return {
        bookingId: booking.id,
        status: booking.status,
        startDate: booking.startDate,
        dateBooked: booking.createdAt,

        // Full classSchedule + venue
        classSchedule: booking.classSchedule || null,
        venue: venue || null,

        bookedBy: booking.admin
          ? {
            id: booking.admin.id,
            firstName: booking.admin.firstName,
            lastName: booking.admin.lastName,
            email: booking.admin.email,
            role: booking.admin.role,
          }
          : null,

        // totalStudents: students.length,
        students,
        parents,
        emergency,

        paymentPlanData: plan
          ? {
            id: plan.id,
            title: plan.title,
            price: plan.price,
            joiningFee: plan.joiningFee,
            duration: plan.duration,
          }
          : null,

        payment: paymentData,
      };
    });

    // -------------------------------
    // Collect all unique venues
    // -------------------------------
    const venueMap = {};
    bookings.forEach((b) => {
      if (b.classSchedule?.venue) {
        venueMap[b.classSchedule.venue.id] = b.classSchedule.venue;
      }
    });
    const allVenues = Object.values(venueMap);

    // -------------------------------
    // Collect all unique bookedByAdmins
    // -------------------------------
    const adminMap = {};
    bookings.forEach((b) => {
      if (b.admin) {
        adminMap[b.admin.id] = {
          id: b.admin.id,
          firstName: b.admin.firstName,
          lastName: b.admin.lastName,
          email: b.admin.email,
          role: b.admin.role,
        };
      }
    });
    const allAdmins = Object.values(adminMap);

    // -------------------------------
    // Stats Calculation
    // -------------------------------
    const totalSales = memberShipSales.length;

    const totalRevenue = memberShipSales.reduce((acc, b) => {
      const plan = b.paymentPlanData;
      if (plan && plan.price != null) {
        const studentsCount = b.students?.length || 1;
        return acc + (plan.price + (plan.joiningFee || 0)) * studentsCount;
      }
      return acc;
    }, 0);

    const avgMonthlyFeeRaw =
      memberShipSales.reduce((acc, b) => {
        const plan = b.paymentPlanData;
        if (plan && plan.duration && plan.price != null) {
          const studentsCount = b.students?.length || 1;
          const monthlyFee =
            (plan.price + (plan.joiningFee || 0)) / plan.duration;
          return acc + monthlyFee * studentsCount;
        }
        return acc;
      }, 0) / (totalSales || 1);

    // ✅ Round to 2 decimals
    const avgMonthlyFee = Math.round(avgMonthlyFeeRaw * 100) / 100;

    const topSaleAgent = memberShipSales.length > 0 ? 1 : 0; // placeholder

    const stats = {
      totalSales: { value: totalSales, change: 0 },
      totalRevenue: { value: totalRevenue, change: 0 },
      avgMonthlyFee: { value: avgMonthlyFee, change: 0 },
      topSaleAgent: { value: topSaleAgent, change: 0 },
    };

    // -------------------------------
    // Final response
    // -------------------------------
    return {
      status: true,
      message: "Paid bookings retrieved successfully",
      data: {
        memberShipSales,
        venue: allVenues, // ✅ all unique venues
        bookedByAdmins: allAdmins, // ✅ all unique bookedByAdmins
      },
      stats,
    };
  } catch (error) {
    console.error("❌ getActiveMembershipBookings Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.sendActiveMemberSaleEmailToParents = async ({ bookingId }) => {
  try {
    // 1️⃣ Fetch main booking
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
    const startDate = booking.startDate;
    const additionalNote = booking.additionalNote || "";

    // 4️⃣ Email template
    const emailConfigResult = await getEmailConfig("admin", "booking-status");
    if (!emailConfigResult.status) {
      return { status: false, message: "Email config missing" };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    let sentTo = [];

    // 5️⃣ Loop over students
    for (const student of studentMetas) {
      // Get all parents for this student
      const parents = await BookingParentMeta.findAll({
        where: { studentId: student.id },
      });

      if (!parents.length) continue;

      let noteHtml = "";
      if (additionalNote && additionalNote.trim() !== "") {
        noteHtml = `<p><strong>Additional Note:</strong> ${additionalNote}</p>`;
      }

      // 6️⃣ Send email to each parent
      for (const parent of parents) {
        if (!parent?.parentEmail) continue;

        let finalHtml = htmlTemplate
          .replace(/{{parentName}}/g, parent.parentFirstName)
          .replace(/{{studentFirstName}}/g, student.studentFirstName)
          .replace(/{{studentLastName}}/g, student.studentLastName)
          .replace(
            /{{studentName}}/g,
            `${student.studentFirstName} ${student.studentLastName}`
          )
          .replace(/{{status}}/g, booking.status) // make sure booking.status exists
          .replace(/{{venueName}}/g, venueName)
          .replace(/{{className}}/g, className)
          .replace(/{{classTime}}/g, classTime)
          .replace(/{{startDate}}/g, startDate)
          .replace(/{{additionalNoteSection}}/g, noteHtml)
          .replace(/{{appName}}/g, "Synco")
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

exports.transferClass = async (data, options) => {
  const t = await sequelize.transaction();
  try {
    const adminId = options?.adminId || null;

    // 🔹 Step 1: Find Booking
    const booking = await Booking.findByPk(data.bookingId, { transaction: t });
    if (!booking) throw new Error("Booking not found.");

    // 🔹 Step 2: Validate new ClassSchedule
    const newClassSchedule = await ClassSchedule.findByPk(
      data.classScheduleId, // ✅ match your payload
      { transaction: t }
    );
    if (!newClassSchedule) throw new Error("New class schedule not found.");

    // 🔹 Step 3: Validate Venue
    let newVenueId = data.venueId || newClassSchedule.venueId;
    if (newVenueId) {
      const newVenue = await Venue.findByPk(newVenueId, { transaction: t });
      if (!newVenue) throw new Error("New venue not found.");
    }

    // 🔹 Step 4: Update Booking
    booking.classScheduleId = data.classScheduleId;
    booking.venueId = newVenueId;
    booking.updatedAt = new Date();
    await booking.save({ transaction: t });

    // 🔹 Step 5: Upsert CancelBooking
    const existingCancel = await CancelBooking.findOne({
      where: { bookingId: booking.id, bookingType: "membership" },
      transaction: t,
    });

    if (existingCancel) {
      await existingCancel.update(
        {
          transferReasonClass: data.transferReasonClass,
          updatedAt: new Date(),
          createdBy: adminId,
        },
        { transaction: t }
      );
    } else {
      await CancelBooking.create(
        {
          bookingId: booking.id,
          bookingType: "membership",
          transferReasonClass: data.transferReasonClass,
          createdBy: adminId,
        },
        { transaction: t }
      );
    }

    // 🔹 Step 6: Commit
    await t.commit();

    return {
      status: true,
      message: "Class transferred successfully.",
      data: {
        bookingId: booking.id,
        classScheduleId: booking.classScheduleId,
        venueId: booking.venueId,
        transferReasonClass: data.transferReasonClass,
      },
    };
  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

exports.addToWaitingListService = async (data, adminId) => {
  const t = await sequelize.transaction();
  try {
    console.log("🚀 [Service] addToWaitingListService started", {
      data,
      adminId,
    });

    // 1️⃣ Fetch original booking with relations
    const originalBooking = await Booking.findByPk(data.bookingId, {
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
        { model: BookingPayment, as: "payments" }, // payments under booking
      ],
      transaction: t,
    });

    if (!originalBooking) throw new Error("Invalid booking selected.");

    // ✅ Only clone from paid + active bookings
    if (
      !(
        originalBooking.bookingType === "paid" &&
        originalBooking.status === "active"
      )
    ) {
      throw new Error(
        `Booking type=${originalBooking.bookingType}, status=${originalBooking.status}. Cannot add to waiting list.`
      );
    }

    // Validate venue and class schedule
    const venue = await Venue.findByPk(data.venueId, { transaction: t });
    if (!venue) throw new Error("Invalid venue selected.");

    const classSchedule = await ClassSchedule.findByPk(data.classScheduleId, {
      transaction: t,
    });
    if (!classSchedule) throw new Error("Invalid class schedule selected.");

    // Prevent duplicate waiting list entries
    const studentIds = originalBooking.students.map((s) => s.id);
    const existingWaiting = await Booking.findOne({
      where: { classScheduleId: data.classScheduleId, status: "waiting list" },
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          where: { id: studentIds },
        },
      ],
      transaction: t,
    });

    if (existingWaiting)
      throw new Error(
        "One or more students already have a waiting list entry for this class."
      );

    // 2️⃣ Create new waiting list booking (clone paymentPlanId from originalBooking)
    const waitingBooking = await Booking.create(
      {
        bookingId: generateBookingId(),
        bookingType: "waiting list",
        venueId: data.venueId,
        classScheduleId: data.classScheduleId,
        paymentPlanId: originalBooking.paymentPlanId || null, // clone value, keep null if original is null
        startDate: data.startDate || null,
        additionalNote: data.additionalNote || null,
        bookedBy: adminId,
        status: "waiting list",
        totalStudents: originalBooking.totalStudents || 1,
        interest: originalBooking.interest || "medium",
        keyInformation: originalBooking.keyInformation || null,
      },
      { transaction: t }
    );

    // 3️⃣ Clone payments (linked to booking)
    for (const payment of originalBooking.payments || []) {
      await BookingPayment.create(
        {
          bookingId: waitingBooking.id,
          firstName: payment.firstName,
          lastName: payment.lastName,
          email: payment.email,
          billingAddress: payment.billingAddress,
          cardHolderName: payment.cardHolderName,
          cv2: payment.cv2,
          expiryDate: payment.expiryDate,
          paymentType: payment.paymentType,
          pan: payment.pan,
          paymentStatus: payment.paymentStatus,
          referenceId: payment.referenceId,
          currency: payment.currency,
          merchantRef: payment.merchantRef,
          description: payment.description,
          commerceType: payment.commerceType,
          gatewayResponse: payment.gatewayResponse,
          transactionMeta: payment.transactionMeta,
        },
        { transaction: t }
      );
    }

    // 4️⃣ Clone students + parents + emergency contacts
    for (const student of originalBooking.students) {
      const newStudent = await BookingStudentMeta.create(
        {
          bookingTrialId: waitingBooking.id,
          studentFirstName: student.studentFirstName,
          studentLastName: student.studentLastName,
          dateOfBirth: student.dateOfBirth,
          age: student.age,
          gender: student.gender,
          medicalInformation: student.medicalInformation,
        },
        { transaction: t }
      );

      for (const parent of student.parents || []) {
        await BookingParentMeta.create(
          {
            studentId: newStudent.id,
            parentFirstName: parent.parentFirstName,
            parentLastName: parent.parentLastName,
            parentEmail: parent.parentEmail,
            parentPhoneNumber: parent.parentPhoneNumber,
            relationToChild: parent.relationToChild,
            howDidYouHear: parent.howDidYouHear,
          },
          { transaction: t }
        );
      }

      for (const emergency of student.emergencyContacts || []) {
        await BookingEmergencyMeta.create(
          {
            studentId: newStudent.id,
            emergencyFirstName: emergency.emergencyFirstName,
            emergencyLastName: emergency.emergencyLastName,
            emergencyPhoneNumber: emergency.emergencyPhoneNumber,
            emergencyRelation: emergency.emergencyRelation,
          },
          { transaction: t }
        );
      }
    }

    // 5️⃣ Reload new booking with relations before commit
    const finalBooking = await Booking.findByPk(waitingBooking.id, {
      include: [
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
        { model: BookingPayment, as: "payments" },
      ],
      transaction: t,
    });

    // 6️⃣ Commit transaction
    await t.commit();

    // 7️⃣ Simplified response
    const simplified = {
      venueId: finalBooking.venueId,
      classScheduleId: finalBooking.classScheduleId,
      paymentPlanId: finalBooking.paymentPlanId,
      startDate: finalBooking.startDate,
      totalStudents: finalBooking.totalStudents,
      keyInformation: finalBooking.keyInformation,
      students: finalBooking.students.map((s) => ({
        studentFirstName: s.studentFirstName,
        studentLastName: s.studentLastName,
        dateOfBirth: s.dateOfBirth,
        age: s.age,
        gender: s.gender,
        medicalInformation: s.medicalInformation,
      })),
      parents: finalBooking.students.flatMap((s) =>
        (s.parents || []).map((p) => ({
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        }))
      ),
      emergency:
        finalBooking.students
          .flatMap((s) => s.emergencyContacts || [])
          .map((e) => ({
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          }))[0] || null,
    };

    return {
      status: true,
      message: "Booking added to waiting list successfully.",
      data: simplified,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ [Service] addToWaitingListService error:", error);
    return {
      status: false,
      message: error.message || "Server error.",
      data: null,
    };
  }
};

exports.getWaitingList = async () => {
  try {
    const waitingListEntries = await WaitingList.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          include: [
            {
              model: BookingStudentMeta,
              as: "students",
              include: [
                { model: BookingParentMeta, as: "parents" },
                { model: BookingEmergencyMeta, as: "emergencyContacts" },
              ],
            },
          ],
        },
        { model: Venue, as: "venue" },
        { model: ClassSchedule, as: "classSchedule" },
      ],
      order: [["createdAt", "DESC"]],
    });

    const formattedData = waitingListEntries.map((entry) => {
      const booking = entry.booking;

      const students = booking.students.map((student) => ({
        studentFirstName: student.studentFirstName,
        studentLastName: student.studentLastName,
        dateOfBirth: student.dateOfBirth,
        age: student.age,
        gender: student.gender,
        medicalInformation: student.medicalInformation,
      }));

      const parents = booking.students.flatMap((student) =>
        student.parents.map((p) => ({
          parentFirstName: p.parentFirstName,
          parentLastName: p.parentLastName,
          parentEmail: p.parentEmail,
          parentPhoneNumber: p.parentPhoneNumber,
          relationToChild: p.relationToChild,
          howDidYouHear: p.howDidYouHear,
        }))
      );

      const emergencyContactRaw =
        booking.students[0]?.emergencyContacts?.[0] || null;

      const emergency = emergencyContactRaw
        ? {
          emergencyFirstName: emergencyContactRaw.emergencyFirstName,
          emergencyLastName: emergencyContactRaw.emergencyLastName,
          emergencyPhoneNumber: emergencyContactRaw.emergencyPhoneNumber,
          emergencyRelation: emergencyContactRaw.emergencyRelation,
        }
        : null;

      return {
        id: entry.id,
        bookingId: booking.id, // <-- bookingId included
        venue: entry.venue,
        classSchedule: entry.classSchedule,

        students,
        parents,
        emergency,
      };
    });

    return {
      status: true,
      data: formattedData,
      message: "Waiting list retrieved successfully",
    };
  } catch (error) {
    console.error("❌ getWaitingList service error:", error);
    return { status: false, message: error.message };
  }
};

exports.getBookingsById = async (bookingId) => {
  try {
    const booking = await Booking.findOne({
      where: {
        id: bookingId,
        bookingType: { [Op.or]: ["waiting list", "paid"] }, // <-- both types
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
          required: false,
          include: [{ model: Venue, as: "venue", required: false }],
        },
        { model: BookingPayment, as: "payments", required: false },
        { model: PaymentPlan, as: "paymentPlan", required: false },
        {
          model: Admin,
          as: "bookedByAdmin",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "email",
            "roleId",
            "status",
            "profile",
          ],
          required: false,
        },
      ],
    });

    if (!booking) {
      return { status: false, message: "Booking not found" };
    }

    // ✅ extract venueId from this booking
    const venueId = booking.classSchedule?.venue?.id || null;

    let newClasses = [];
    if (venueId) {
      // 🔎 find all other class schedules in the same venue
      newClasses = await ClassSchedule.findAll({
        where: { venueId },
      });
    }

    // ✅ Parse booking as before
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
      booking.students?.flatMap(
        (s) =>
          s.parents?.map((p) => ({
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            parentPhoneNumber: p.parentPhoneNumber,
            relationToChild: p.relationToChild,
            howDidYouHear: p.howDidYouHear,
          })) || []
      ) || [];

    const emergency =
      booking.students?.flatMap(
        (s) =>
          s.emergencyContacts?.map((e) => ({
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          })) || []
      ) || [];

    const venue = booking.classSchedule?.venue || null;
    const plan = booking.paymentPlan || null;

    const payments =
      booking.payments?.map((p) => ({
        ...p.get({ plain: true }),
        gatewayResponse: (() => {
          try {
            return JSON.parse(p.gatewayResponse);
          } catch {
            return p.gatewayResponse;
          }
        })(),
        transactionMeta: (() => {
          try {
            return JSON.parse(p.transactionMeta);
          } catch {
            return p.transactionMeta;
          }
        })(),
      })) || [];

    const payment = payments[0] || null;

    const parsedBooking = {
      bookingId: booking.id,
      status: booking.status,
      startDate: booking.startDate,
      dateBooked: booking.createdAt,

      students,
      parents,
      emergency,

      classSchedule: booking.classSchedule || null,
      venue,
      paymentPlan: plan,
      payments,

      paymentData: payment
        ? {
          firstName: payment.firstName,
          lastName: payment.lastName,
          email: payment.email,
          billingAddress: payment.billingAddress,
          paymentStatus: payment.paymentStatus,
          totalCost: plan ? plan.price + (plan.joiningFee || 0) : 0,
        }
        : null,

      bookedByAdmin: booking.bookedByAdmin || null,
      newClasses,
    };

    return {
      status: true,
      message: "Paid booking retrieved successfully",
      totalPaidBookings: 1,
      data: parsedBooking,
    };
  } catch (error) {
    console.error("❌ getBookingsById Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.retryBookingPayment = async (bookingId, newData) => {
  console.log(
    "🔹 [Service] Starting retryBookingPayment for bookingId:",
    bookingId
  );

  const t = await sequelize.transaction();
  try {
    // Step 1: Find Booking
    const booking = await Booking.findByPk(bookingId, { transaction: t });
    if (!booking) throw new Error("Booking not found");
    console.log("✅ [Service] Booking found:", booking.id);

    // Step 2: Find latest payment
    const latestPayment = await BookingPayment.findOne({
      where: { bookingId: booking.id },
      order: [["createdAt", "DESC"]],
      transaction: t,
    });
    if (!latestPayment) throw new Error("No payment found to retry");

    if (latestPayment.paymentStatus === "paid") {
      console.log("⚠️ Payment already successful, nothing to retry.");
      await t.commit();
      return {
        status: true,
        message: "Payment already successful, nothing to retry.",
        paymentStatus: "paid",
        studentId: booking.studentId,
      };
    }

    // Step 3: Load plan
    if (newData.paymentPlanId) {
      booking.paymentPlanId = newData.paymentPlanId;
      await booking.save({ transaction: t });
      console.log("✅ Booking plan updated");
    }

    const paymentPlan = await PaymentPlan.findByPk(booking.paymentPlanId, {
      transaction: t,
    });
    if (!paymentPlan) throw new Error("Invalid payment plan selected.");
    const price = paymentPlan.price || 0;

    const venue = await Venue.findByPk(booking.venueId, { transaction: t });
    const classSchedule = await ClassSchedule.findByPk(
      booking.classScheduleId,
      { transaction: t }
    );

    const merchantRef = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;

    let paymentStatusFromGateway = "pending";
    let gatewayResponse = null;
    let transactionMeta = null;

    // Step 4: Retry payment
    // Step 4: Retry payment
    try {
      if (newData?.payment?.paymentType === "rrn") {
        console.log("🔹 [Service] Retrying via GoCardless RRN...");

        if (!newData.payment.referenceId)
          throw new Error("Reference ID is required for RRN payments.");

        const gcPayload = {
          billing_requests: {
            payment_request: {
              amount: Math.round(price * 100), // in pence
              currency: "GBP",
              description: `Booking retry for ${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
                }`,
              metadata: {
                bookingId: String(booking.id), // must be string
                retry: "true", // must be string
                referenceId: newData.payment.referenceId,
              },
            },
            mandate_request: {
              currency: "GBP",
              scheme: "bacs",
              metadata: {
                bookingId: String(booking.id), // must be string
              },
            },
            metadata: { test: `BR${Math.floor(Math.random() * 1000000)}` },
            links: {},
          },
        };

        console.log("📦 RRN Payload:", gcPayload);

        const response = await axios.post(
          "https://api-sandbox.gocardless.com/billing_requests",
          gcPayload,
          {
            headers: {
              Authorization: `Bearer ${process.env.GOCARDLESS_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
              "GoCardless-Version": "2015-07-06",
            },
          }
        );

        gatewayResponse = response.data;
        console.log("✅ GoCardless Response:", gatewayResponse);

        const status =
          response.data?.billing_requests?.status?.toLowerCase() || "failed";

        transactionMeta = { status };

        if (["submitted", "pending_submission", "pending"].includes(status))
          paymentStatusFromGateway = "pending";
        else if (status === "confirmed" || status === "paid")
          paymentStatusFromGateway = "paid";
        else if (["failed", "cancelled"].includes(status))
          paymentStatusFromGateway = "failed";
        else paymentStatusFromGateway = "unknown";

        // Force failed if not paid or pending
        if (
          paymentStatusFromGateway !== "paid" &&
          paymentStatusFromGateway !== "pending"
        ) {
          paymentStatusFromGateway = "failed";
        }

        console.log(
          "🔹 [Service] Payment status mapped:",
          paymentStatusFromGateway
        );
      } else if (newData?.payment?.paymentType === "card") {
        console.log("🔹 [Service] Retrying via Pay360 card...");
        const { pan, expiryDate, cardHolderName, cv2 } = newData.payment || {};
        if (!pan || !expiryDate || !cardHolderName || !cv2)
          throw new Error("Missing required card details for Pay360 payment.");

        const paymentPayload = {
          transaction: {
            currency: "GBP",
            amount: price,
            merchantRef,
            description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
              }`,
            commerceType: "ECOM",
          },
          paymentMethod: { card: { pan, expiryDate, cardHolderName, cv2 } },
        };

        console.log("📦 Pay360 Payload:", paymentPayload);

        const url = `https://api.mite.pay360.com/acceptor/rest/transactions/${process.env.PAY360_INST_ID}/payment`;
        const authHeader = Buffer.from(
          `${process.env.PAY360_API_USERNAME}:${process.env.PAY360_API_PASSWORD}`
        ).toString("base64");

        const response = await axios.post(url, paymentPayload, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${authHeader}`,
          },
        });

        gatewayResponse = response.data;
        console.log("✅ Pay360 Response:", gatewayResponse);

        const status =
          response.data?.transaction?.status?.toLowerCase() || "failed";

        transactionMeta = { status };

        if (status === "success" || status === "already_paid")
          paymentStatusFromGateway = "paid";
        else if (status === "pending") paymentStatusFromGateway = "pending";
        else paymentStatusFromGateway = "failed";

        // Force failed if not paid or pending
        if (
          paymentStatusFromGateway !== "paid" &&
          paymentStatusFromGateway !== "pending"
        ) {
          paymentStatusFromGateway = "failed";
        }
      } else {
        throw new Error("Unsupported or missing payment type for retry.");
      }
    } catch (err) {
      console.error(
        "❌ Payment gateway error:",
        err.response?.data || err.message
      );
      paymentStatusFromGateway = "failed";
      gatewayResponse = err.response?.data || { error: err.message };
      transactionMeta = { status: "failed" };
    }

    // Step 5: Update existing BookingPayment
    console.log("🔹 [Service] Updating BookingPayment retry entry...");

    const existingPayment = await BookingPayment.findOne({
      where: { bookingId: booking.id },
      order: [["createdAt", "DESC"]],
      transaction: t,
    });

    if (!existingPayment) throw new Error("No payment record found to update.");

    const firstStudent = await BookingStudentMeta.findOne({
      where: { bookingTrialId: booking.id },
      order: [["createdAt", "ASC"]],
      transaction: t,
    });
    const firstParent = newData.parents?.[0] || {};

    await existingPayment.update(
      {
        studentId: firstStudent?.id || null,
        paymentType: newData.payment.paymentType,
        referenceId: newData.payment.referenceId || existingPayment.referenceId,
        paymentStatus: paymentStatusFromGateway,
        amount: price,
        gatewayResponse, // full raw payload
        transactionMeta, // only { status }
        firstName:
          newData.payment.firstName || firstParent.parentFirstName || "Parent",
        lastName: newData.payment.lastName || firstParent.parentLastName || "",
        merchantRef,
        description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"
          }`,
        commerceType: "ECOM",
        email: newData.payment.email || firstParent.parentEmail || "",
        billingAddress: newData.payment.billingAddress || "",
        cardHolderName: newData.payment.cardHolderName || "",
        cv2: newData.payment.cv2 || "",
        expiryDate: newData.payment.expiryDate || "",
        pan: newData.payment.pan || "",
        updatedAt: new Date(),
      },
      { transaction: t }
    );

    console.log(
      `✅ [Service] BookingPayment retry updated with status: ${paymentStatusFromGateway}`
    );

    await t.commit();
    return {
      status: true,
      message: `Retry payment completed with status: ${paymentStatusFromGateway}`,
      paymentStatus: paymentStatusFromGateway,
      studentId: firstStudent?.id || null,
    };
  } catch (error) {
    console.error("❌ Error in retryBookingPayment:", error.message);
    await t.rollback();
    return { status: false, message: error.message };
  }
};

exports.getFailedPaymentsByBookingId = async (bookingId) => {
  if (!bookingId) {
    throw new Error("Booking ID is required");
  }

  const failedPayments = await BookingPayment.findAll({
    where: {
      bookingId,
      paymentStatus: "failed", // Only failed payments
    },
    order: [["createdAt", "DESC"]],
  });

  // Parse gatewayResponse and transactionMeta
  const parsedPayments = failedPayments.map((payment) => {
    let gatewayResponse = payment.gatewayResponse;
    let transactionMeta = payment.transactionMeta;

    // Ensure JSON parsing if stored as string
    if (typeof gatewayResponse === "string") {
      try {
        gatewayResponse = JSON.parse(gatewayResponse);
      } catch (err) {
        console.error("Failed to parse gatewayResponse:", err.message);
      }
    }

    if (typeof transactionMeta === "string") {
      try {
        transactionMeta = JSON.parse(transactionMeta);
      } catch (err) {
        console.error("Failed to parse transactionMeta:", err.message);
      }
    }

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      studentId: payment.studentId,
      paymentType: payment.paymentType,
      amount: payment.amount,
      paymentStatus: payment.paymentStatus,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      gatewayResponse, // parsed object
      transactionMeta, // parsed object
    };
  });

  return parsedPayments;
};
