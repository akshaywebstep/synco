const {
  oneToOneLeads,
  OneToOneBooking,
  OneToOneStudent,
  OneToOneParent,
  OneToOneEmergency,
  OneToOnePayment,
  PaymentPlan,
  Admin,
  sequelize,
} = require("../../../models");
// const { Op } = require("sequelize");
const { Op, fn, col, literal } = require("sequelize");
const stripe = require("../../../utils/payment/pay360/stripe");
const moment = require("moment");
// ✅ Create
exports.createOnetoOneLeads = async (data) => {
  try {
    const oneToOne = await oneToOneLeads.create(data);
    return { status: true, data: oneToOne.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error creating oneToOne lead:", error);
    return { status: false, message: error.message };
  }
};

// Get All Leads
exports.getAllOnetoOneLeads = async (superAdminId, adminId, filters = {}) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    const { fromDate, toDate, type, studentName } = filters;

    const whereLead = { status: "pending" };
    const whereBooking = { status: "pending" };

    // ✅ Build WHERE conditions for super admin vs admin
    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      whereLead.createdBy = { [Op.in]: adminIds };
    } else if (superAdminId && adminId) {
      // 🟢 Admin → fetch own + super admin’s leads
      whereLead.createdBy = { [Op.in]: [adminId, superAdminId] };
    } else {
      // 🟢 Fallback (in case no superAdminId found)
      whereLead.createdBy = adminId;
    }

    // ✅ Date range filter
    if (fromDate && toDate) {
      whereLead.createdAt = {
        [Op.between]: [
          moment(fromDate, "YYYY-MM-DD").startOf("day").toDate(),
          moment(toDate, "YYYY-MM-DD").endOf("day").toDate(),
        ],
      };
    }

    // ✅ Type filter (if provided)
    if (type) {
      whereBooking.type = { [Op.eq]: type.toLowerCase() };
    }

    // ✅ Fetch leads
    const leads = await oneToOneLeads.findAll({
      where: whereLead,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: !!type,
          where: whereBooking,
          include: [
            {
              model: OneToOneStudent,
              as: "students",
              include: [
                { model: OneToOneParent, as: "parentDetails" },
                { model: OneToOneEmergency, as: "emergencyDetails" },
              ],
            },
            { model: OneToOnePayment, as: "payment" },
          ],
        },
      ],
    });

    // ✅ Optional student name filter
    let filteredLeads = leads;
    if (studentName) {
      filteredLeads = leads.filter((lead) => {
        const booking = lead.booking;
        if (!booking || !booking.students) return false;
        return booking.students.some(
          (s) =>
            s.studentFirstName
              ?.toLowerCase()
              .includes(studentName.toLowerCase()) ||
            s.studentLastName?.toLowerCase().includes(studentName.toLowerCase())
        );
      });
    }

    // ✅ Format data
    const formattedData = await Promise.all(
      filteredLeads.map(async (lead) => {
        const leadPlain = lead.get({ plain: true });
        const booking = leadPlain.booking;

        if (!booking) return leadPlain;

        const students = (booking.students || []).map((s) => ({
          studentFirstName: s.studentFirstName,
          studentLastName: s.studentLastName,
          dateOfBirth: s.dateOfBirth,
          age: s.age,
          gender: s.gender,
          medicalInfo: s.medicalInfo,
        }));

        const parents = (booking.students || [])
          .map((s) => s.parentDetails)
          .filter(Boolean)
          .map((p) => ({
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            phoneNumber: p.phoneNumber,
            relationChild: p.relationChild,
            howDidHear: p.howDidHear,
          }));

        const emergencyObj =
          booking.students?.find((s) => s.emergencyDetails)?.emergencyDetails ||
          null;
        const emergency = emergencyObj
          ? {
            emergencyFirstName: emergencyObj.emergencyFirstName,
            emergencyLastName: emergencyObj.emergencyLastName,
            emergencyPhoneNumber: emergencyObj.phoneNumber,
            emergencyRelation: emergencyObj.relationChild,
          }
          : null;

        let paymentObj = null;
        if (booking.payment) {
          const stripeChargeId = booking.payment.stripePaymentIntentId;
          let stripeChargeDetails = null;

          if (stripeChargeId) {
            try {
              if (stripeChargeId.startsWith("pi_")) {
                const paymentIntent = await stripe.paymentIntents.retrieve(
                  stripeChargeId,
                  {
                    expand: ["latest_charge"],
                  }
                );
                if (paymentIntent.latest_charge) {
                  stripeChargeDetails = await stripe.charges.retrieve(
                    paymentIntent.latest_charge
                  );
                }
              } else if (stripeChargeId.startsWith("ch_")) {
                stripeChargeDetails = await stripe.charges.retrieve(
                  stripeChargeId
                );
              }
            } catch (err) {
              console.error("⚠️ Failed to fetch charge details:", err.message);
            }
          }

          paymentObj = {
            stripePaymentIntentId: stripeChargeId,
            baseAmount: booking.payment.baseAmount,
            discountAmount: booking.payment.discountAmount,
            amount: booking.payment.amount,
            currency: booking.payment.currency,
            paymentStatus: booking.payment.paymentStatus,
            paymentDate: booking.payment.paymentDate,
            failureReason: booking.payment.failureReason,
            stripeChargeDetails: stripeChargeDetails
              ? {
                id: stripeChargeDetails.id,
                amount: stripeChargeDetails.amount / 100,
                currency: stripeChargeDetails.currency,
                status: stripeChargeDetails.status,
                paymentMethod:
                  stripeChargeDetails.payment_method_details?.card?.brand,
                last4:
                  stripeChargeDetails.payment_method_details?.card?.last4,
                receiptUrl: stripeChargeDetails.receipt_url,
                fullResponse: stripeChargeDetails,
              }
              : null,
          };
        }

        return {
          ...leadPlain,
          booking: {
            leadId: booking.leadId,
            coachId: booking.coachId,
            type: booking.type,
            location: booking.location,
            address: booking.address,
            date: booking.date,
            time: booking.time,
            totalStudents: booking.totalStudents,
            areaWorkOn: booking.areaWorkOn,
            paymentPlanId: booking.paymentPlanId,
            discountId: booking.discountId,
            students,
            parents,
            emergency,
            payment: paymentObj,
          },
        };
      })
    );

    // ✅ Summary counts (super admin or admin scope)
    const whereSummary = { status: "pending" };
    if (superAdminId && superAdminId === adminId) {
      // super admin → all admins + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      whereSummary.createdBy = { [Op.in]: adminIds };
    } else {
      whereSummary.createdBy = { [Op.in]: [adminId, superAdminId] };
    }

    const totalLeads = await oneToOneLeads.count({ where: whereSummary });

    const startOfMonth = moment().startOf("month").toDate();
    const endOfMonth = moment().endOf("month").toDate();

    const newLeads = await oneToOneLeads.count({
      where: {
        ...whereSummary,
        createdAt: { [Op.between]: [startOfMonth, endOfMonth] },
      },
    });

    const leadsWithBookings = await oneToOneLeads.count({
      where: whereSummary,
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          where: { status: "pending" },
        },
      ],
    });

    const sourceCount = await oneToOneLeads.findAll({
      where: whereSummary,
      attributes: [
        "source",
        [sequelize.fn("COUNT", sequelize.col("source")), "count"],
      ],
      group: ["source"],
    });

    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary: {
          totalLeads,
          newLeads,
          leadsWithBookings,
          sourceOfBookings: sourceCount,
        },
      };
    }

    return {
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary: {
        totalLeads,
        newLeads,
        leadsWithBookings,
        sourceOfBookings: sourceCount,
      },
      data: formattedData,
    };
  } catch (error) {
    console.error("❌ Error fetching oneToOne leads:", error);
    return { status: false, message: error.message };
  }
};

// Get All Sales
exports.getAllOnetoOneLeadsSales = async (
  superAdminId,
  adminId,
  filters = {}
) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    const { fromDate, toDate, type, studentName } = filters;

    // const whereLead = {};
    // const whereBooking = {};

    const whereLead = { status: "active" }; // ✅ Only pending leads
    const whereBooking = { status: "active" }; // ✅ Only pending bookings

    // ✅ If user is Super Admin — show all leads for their managed admins + self
    if (superAdminId === adminId) {
      // 🧩 Super Admin: fetch all admins under this super admin (including self)
      const managedAdmins = await Admin.findAll({
        where: { superAdminId }, // ✅ correct column name
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId); // include the super admin themselves

      whereLead.createdBy = { [Op.in]: adminIds };
    } else {
      // 🧩 Normal Admin: only see own leads
      whereLead.createdBy = adminId;
    }

    if (fromDate && toDate) {
      whereLead.createdAt = {
        [Op.between]: [
          moment(fromDate, "YYYY-MM-DD").startOf("day").toDate(),
          moment(toDate, "YYYY-MM-DD").endOf("day").toDate(),
        ],
      };
    }

    if (type) {
      whereBooking.type = { [Op.eq]: type.toLowerCase() }; // makes it case-insensitive friendly
    }

    const leads = await oneToOneLeads.findAll({
      where: {
        ...whereLead,
        status: "active",
      },
      order: [["createdAt", "DESC"]],
      include: [
        // ✅ Include creator (Admin who created this lead)
        {
          model: Admin,
          as: "creator",
        },

        {
          model: OneToOneBooking,
          as: "booking",
          required: !!type, // still only strict join when filtering by type
          where: !!type
            ? {
              ...(Object.keys(whereBooking).length ? whereBooking : {}),
              status: "active",
            }
            : undefined, // <- important: no where when no type, keeps LEFT JOIN
          include: [
            {
              model: OneToOneStudent,
              as: "students",
              include: [
                { model: OneToOneParent, as: "parentDetails" },
                { model: OneToOneEmergency, as: "emergencyDetails" },
              ],
            },
            { model: OneToOnePayment, as: "payment" },
            { model: PaymentPlan, as: "paymentPlan" },
          ],
        },
      ],
    });

    // 🧠 Optional Student Name Filter
    let filteredLeads = leads;
    if (studentName) {
      filteredLeads = leads.filter((lead) => {
        const booking = lead.booking;
        if (!booking || !booking.students) return false;
        return booking.students.some(
          (s) =>
            s.studentFirstName
              ?.toLowerCase()
              .includes(studentName.toLowerCase()) ||
            s.studentLastName?.toLowerCase().includes(studentName.toLowerCase())
        );
      });
    }

    // 🧾 Format Data
    const formattedData = await Promise.all(
      filteredLeads.map(async (lead) => {
        const leadPlain = lead.get({ plain: true });
        const booking = leadPlain.booking;

        if (!booking) return leadPlain;

        // Students
        const students = (booking.students || []).map((s) => ({
          studentFirstName: s.studentFirstName,
          studentLastName: s.studentLastName,
          dateOfBirth: s.dateOfBirth,
          age: s.age,
          gender: s.gender,
          medicalInfo: s.medicalInfo,
        }));

        // Parents
        const parents = (booking.students || [])
          .map((s) => s.parentDetails)
          .filter(Boolean)
          .map((p) => ({
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            phoneNumber: p.phoneNumber,
            relationChild: p.relationChild,
            howDidHear: p.howDidHear,
          }));

        // Emergency
        const emergencyObj =
          booking.students?.find((s) => s.emergencyDetails)?.emergencyDetails ||
          null;
        const emergency = emergencyObj
          ? {
            emergencyFirstName: emergencyObj.emergencyFirstName,
            emergencyLastName: emergencyObj.emergencyLastName,
            emergencyPhoneNumber: emergencyObj.phoneNumber,
            emergencyRelation: emergencyObj.relationChild,
          }
          : null;

        // Payment + Stripe charge details
        let paymentObj = null;
        if (booking.payment) {
          const stripeChargeId = booking.payment.stripePaymentIntentId;
          let stripeChargeDetails = null;

          if (stripeChargeId) {
            try {
              if (stripeChargeId.startsWith("pi_")) {
                const paymentIntent = await stripe.paymentIntents.retrieve(
                  stripeChargeId,
                  { expand: ["latest_charge"] }
                );
                if (paymentIntent.latest_charge) {
                  stripeChargeDetails = await stripe.charges.retrieve(
                    paymentIntent.latest_charge
                  );
                }
              } else if (stripeChargeId.startsWith("ch_")) {
                stripeChargeDetails = await stripe.charges.retrieve(
                  stripeChargeId
                );
              }
            } catch (err) {
              console.error("⚠️ Failed to fetch charge details:", err.message);
            }
          }

          paymentObj = {
            stripePaymentIntentId: stripeChargeId,
            baseAmount: booking.payment.baseAmount,
            discountAmount: booking.payment.discountAmount,
            amount: booking.payment.amount,
            currency: booking.payment.currency,
            paymentStatus: booking.payment.paymentStatus,
            paymentDate: booking.payment.paymentDate,
            failureReason: booking.payment.failureReason,
            stripeChargeDetails: stripeChargeDetails
              ? {
                id: stripeChargeDetails.id,
                amount: stripeChargeDetails.amount / 100,
                currency: stripeChargeDetails.currency,
                status: stripeChargeDetails.status,
                paymentMethod:
                  stripeChargeDetails.payment_method_details?.card?.brand,
                last4:
                  stripeChargeDetails.payment_method_details?.card?.last4,
                receiptUrl: stripeChargeDetails.receipt_url,
                fullResponse: stripeChargeDetails,
              }
              : null,
          };
        }

        return {
          ...leadPlain,
          creator: leadPlain.creator,
          booking: {
            leadId: booking.leadId,
            coachId: booking.coachId,
            type: booking.type,
            location: booking.location,
            address: booking.address,
            date: booking.date,
            time: booking.time,
            totalStudents: booking.totalStudents,
            areaWorkOn: booking.areaWorkOn,
            paymentPlanId: booking.paymentPlanId,
            paymentPlan: booking.paymentPlan,
            discountId: booking.discountId,
            students,
            parents,
            emergency,
            payment: paymentObj,
          },
        };
      })
    );

    // ✅ Collect all unique locations
    const locationSummary = {};
    formattedData.forEach((lead) => {
      const loc = lead.booking?.location;
      if (loc && loc.trim() !== "") {
        locationSummary[loc] = (locationSummary[loc] || 0) + 1;
      }
    });
    const locations = Object.keys(locationSummary);

    // ✅ Summary (only pending)
    const totalLeads = await oneToOneLeads.count({
      where: { createdBy: adminId, status: "active" },
    });

    const startOfMonth = moment().startOf("month").toDate();
    const endOfMonth = moment().endOf("month").toDate();

    const newLeads = await oneToOneLeads.count({
      where: {
        createdBy: adminId,
        status: "active",
        createdAt: { [Op.between]: [startOfMonth, endOfMonth] },
      },
    });

    const leadsWithBookings = await oneToOneLeads.count({
      where: { createdBy: adminId, status: "active" },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          where: { status: "active" },
        },
      ],
    });

    const sourceCount = await oneToOneLeads.findAll({
      where: { createdBy: adminId, status: "active" },
      attributes: [
        "source",
        [sequelize.fn("COUNT", sequelize.col("source")), "count"],
      ],
      group: ["source"],
    });

    // ✅ Final Response
    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary: {
          totalLeads,
          newLeads,
          leadsWithBookings,
          sourceOfBookings: sourceCount,
        },
      };
    }

    return {
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary: {
        totalLeads,
        newLeads,
        leadsWithBookings,
        sourceOfBookings: sourceCount,
      },
      locations,
      locationSummary,
      data: formattedData,
    };
  } catch (error) {
    console.error("❌ Error fetching oneToOne leads:", error);
    return { status: false, message: error.message };
  }
};

// Get All Sales and Leads both
exports.getAllOnetoOneLeadsSalesAll = async (
  superAdminId,
  adminId,
  filters = {}
) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    const { fromDate, toDate, type, studentName } = filters;

    const whereLead = {};
    const whereBooking = {};

    // ✅ If user is Super Admin — show all leads for their managed admins + self
    if (superAdminId === adminId) {
      // 🧩 Super Admin: fetch all admins under this super admin (including self)
      const managedAdmins = await Admin.findAll({
        where: { superAdminId }, // ✅ correct column name
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId); // include the super admin themselves

      whereLead.createdBy = { [Op.in]: adminIds };
    } else {
      // 🧩 Normal Admin: only see own leads
      whereLead.createdBy = adminId;
    }

    if (fromDate && toDate) {
      whereLead.createdAt = {
        [Op.between]: [
          moment(fromDate, "YYYY-MM-DD").startOf("day").toDate(),
          moment(toDate, "YYYY-MM-DD").endOf("day").toDate(),
        ],
      };
    }

    if (type) {
      whereBooking.type = { [Op.eq]: type.toLowerCase() }; // makes it case-insensitive friendly
    }

    const leads = await oneToOneLeads.findAll({
      where: {
        ...whereLead,
      },
      order: [["createdAt", "DESC"]],
      include: [
        // ✅ Include creator (Admin who created this lead)
        {
          model: Admin,
          as: "creator",
        },

        {
          model: OneToOneBooking,
          as: "booking",
          required: !!type, // still only strict join when filtering by type
          where: !!type
            ? {
              ...(Object.keys(whereBooking).length ? whereBooking : {}),
            }
            : undefined, // <- important: no where when no type, keeps LEFT JOIN
          include: [
            {
              model: OneToOneStudent,
              as: "students",
              include: [
                { model: OneToOneParent, as: "parentDetails" },
                { model: OneToOneEmergency, as: "emergencyDetails" },
              ],
            },
            { model: OneToOnePayment, as: "payment" },
            { model: PaymentPlan, as: "paymentPlan" },
          ],
        },
      ],
    });

    // 🧠 Optional Student Name Filter
    let filteredLeads = leads;
    if (studentName) {
      filteredLeads = leads.filter((lead) => {
        const booking = lead.booking;
        if (!booking || !booking.students) return false;
        return booking.students.some(
          (s) =>
            s.studentFirstName
              ?.toLowerCase()
              .includes(studentName.toLowerCase()) ||
            s.studentLastName?.toLowerCase().includes(studentName.toLowerCase())
        );
      });
    }

    // 🧾 Format Data
    const formattedData = await Promise.all(
      filteredLeads.map(async (lead) => {
        const leadPlain = lead.get({ plain: true });
        const booking = leadPlain.booking;

        if (!booking) return leadPlain;

        // Students
        const students = (booking.students || []).map((s) => ({
          studentFirstName: s.studentFirstName,
          studentLastName: s.studentLastName,
          dateOfBirth: s.dateOfBirth,
          age: s.age,
          gender: s.gender,
          medicalInfo: s.medicalInfo,
        }));

        // Parents
        const parents = (booking.students || [])
          .map((s) => s.parentDetails)
          .filter(Boolean)
          .map((p) => ({
            parentFirstName: p.parentFirstName,
            parentLastName: p.parentLastName,
            parentEmail: p.parentEmail,
            phoneNumber: p.phoneNumber,
            relationChild: p.relationChild,
            howDidHear: p.howDidHear,
          }));

        // Emergency
        const emergencyObj =
          booking.students?.find((s) => s.emergencyDetails)?.emergencyDetails ||
          null;
        const emergency = emergencyObj
          ? {
            emergencyFirstName: emergencyObj.emergencyFirstName,
            emergencyLastName: emergencyObj.emergencyLastName,
            emergencyPhoneNumber: emergencyObj.phoneNumber,
            emergencyRelation: emergencyObj.relationChild,
          }
          : null;

        // Payment + Stripe charge details
        let paymentObj = null;
        if (booking.payment) {
          const stripeChargeId = booking.payment.stripePaymentIntentId;
          let stripeChargeDetails = null;

          if (stripeChargeId) {
            try {
              if (stripeChargeId.startsWith("pi_")) {
                const paymentIntent = await stripe.paymentIntents.retrieve(
                  stripeChargeId,
                  { expand: ["latest_charge"] }
                );
                if (paymentIntent.latest_charge) {
                  stripeChargeDetails = await stripe.charges.retrieve(
                    paymentIntent.latest_charge
                  );
                }
              } else if (stripeChargeId.startsWith("ch_")) {
                stripeChargeDetails = await stripe.charges.retrieve(
                  stripeChargeId
                );
              }
            } catch (err) {
              console.error("⚠️ Failed to fetch charge details:", err.message);
            }
          }

          paymentObj = {
            stripePaymentIntentId: stripeChargeId,
            baseAmount: booking.payment.baseAmount,
            discountAmount: booking.payment.discountAmount,
            amount: booking.payment.amount,
            currency: booking.payment.currency,
            paymentStatus: booking.payment.paymentStatus,
            paymentDate: booking.payment.paymentDate,
            failureReason: booking.payment.failureReason,
            stripeChargeDetails: stripeChargeDetails
              ? {
                id: stripeChargeDetails.id,
                amount: stripeChargeDetails.amount / 100,
                currency: stripeChargeDetails.currency,
                status: stripeChargeDetails.status,
                paymentMethod:
                  stripeChargeDetails.payment_method_details?.card?.brand,
                last4:
                  stripeChargeDetails.payment_method_details?.card?.last4,
                receiptUrl: stripeChargeDetails.receipt_url,
                fullResponse: stripeChargeDetails,
              }
              : null,
          };
        }

        return {
          ...leadPlain,
          creator: leadPlain.creator,
          booking: {
            leadId: booking.leadId,
            coachId: booking.coachId,
            type: booking.type,
            location: booking.location,
            address: booking.address,
            date: booking.date,
            time: booking.time,
            totalStudents: booking.totalStudents,
            areaWorkOn: booking.areaWorkOn,
            paymentPlanId: booking.paymentPlanId,
            paymentPlan: booking.paymentPlan,
            discountId: booking.discountId,
            students,
            parents,
            emergency,
            payment: paymentObj,
          },
        };
      })
    );

    // ✅ Collect all unique locations
    const locationSummary = {};
    formattedData.forEach((lead) => {
      const loc = lead.booking?.location;
      if (loc && loc.trim() !== "") {
        locationSummary[loc] = (locationSummary[loc] || 0) + 1;
      }
    });
    const locations = Object.keys(locationSummary);

    // ✅ Summary (only pending)
    const totalLeads = await oneToOneLeads.count({
      where: { createdBy: adminId },
    });

    const startOfMonth = moment().startOf("month").toDate();
    const endOfMonth = moment().endOf("month").toDate();

    const newLeads = await oneToOneLeads.count({
      where: {
        createdBy: adminId,
        status: "active",
        createdAt: { [Op.between]: [startOfMonth, endOfMonth] },
      },
    });

    const leadsWithBookings = await oneToOneLeads.count({
      where: { createdBy: adminId },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          where: { status: "active" },
        },
      ],
    });

    const sourceCount = await oneToOneLeads.findAll({
      where: { createdBy: adminId },
      attributes: [
        "source",
        [sequelize.fn("COUNT", sequelize.col("source")), "count"],
      ],
      group: ["source"],
    });

    // ✅ Final Response
    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary: {
          totalLeads,
          newLeads,
          leadsWithBookings,
          sourceOfBookings: sourceCount,
        },
      };
    }

    return {
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary: {
        totalLeads,
        newLeads,
        leadsWithBookings,
        sourceOfBookings: sourceCount,
      },
      locations,
      locationSummary,
      data: formattedData,
    };
  } catch (error) {
    console.error("❌ Error fetching oneToOne leads:", error);
    return { status: false, message: error.message };
  }
};

exports.getOnetoOneLeadsById = async (id, adminId) => {
  try {
    const lead = await oneToOneLeads.findOne({
      where: { id, createdBy: adminId },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: false,
          include: [
            {
              model: OneToOneStudent,
              as: "students",
              include: [
                { model: OneToOneParent, as: "parentDetails" },
                { model: OneToOneEmergency, as: "emergencyDetails" },
              ],
            },
            { model: OneToOnePayment, as: "payment" },
            { model: PaymentPlan, as: "paymentPlan" },
            { model: Admin, as: "coach" },
          ],
        },
      ],
    });

    if (!lead) {
      return {
        status: false,
        message: "One-to-one lead not found or unauthorized.",
      };
    }

    const leadPlain = lead.get({ plain: true });
    const booking = leadPlain.booking;

    if (!booking) {
      return { status: true, data: leadPlain };
    }

    // 🧩 Extract students
    const students = (booking.students || []).map((s) => ({
      id: s.id,
      studentFirstName: s.studentFirstName,
      studentLastName: s.studentLastName,
      dateOfBirth: s.dateOfBirth,
      age: s.age,
      gender: s.gender,
      medicalInfo: s.medicalInfo,
    }));

    // 🧩 Collect parent details
    const parents = (booking.students || [])
      .map((s) => s.parentDetails)
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        parentFirstName: p.parentFirstName,
        parentLastName: p.parentLastName,
        parentEmail: p.parentEmail,
        phoneNumber: p.phoneNumber,
        relationChild: p.relationChild,
        howDidHear: p.howDidHear,
      }));

    // 🧩 Get emergency contact
    const emergencyObj =
      booking.students && booking.students.length > 0
        ? booking.students.find((s) => s.emergencyDetails)?.emergencyDetails
        : null;

    const emergency = emergencyObj
      ? {
        id: emergencyObj.id,
        emergencyFirstName: emergencyObj.emergencyFirstName,
        emergencyLastName: emergencyObj.emergencyLastName,
        emergencyPhoneNumber: emergencyObj.phoneNumber,
        emergencyRelation: emergencyObj.relationChild,
      }
      : null;

    // 💳 Payment + Stripe details
    let paymentObj = null;
    if (booking.payment) {
      const stripeChargeId = booking.payment.stripePaymentIntentId;
      let stripeChargeDetails = null;

      // ✅ Fetch Stripe details if ID exists
      if (stripeChargeId) {
        try {
          if (stripeChargeId.startsWith("pi_")) {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              stripeChargeId,
              { expand: ["latest_charge"] }
            );
            if (paymentIntent.latest_charge) {
              stripeChargeDetails = await stripe.charges.retrieve(
                paymentIntent.latest_charge
              );
            }
          } else if (stripeChargeId.startsWith("ch_")) {
            stripeChargeDetails = await stripe.charges.retrieve(stripeChargeId);
          }
        } catch (err) {
          console.error("⚠️ Failed to fetch charge details:", err.message);
        }
      }

      paymentObj = {
        stripePaymentIntentId: stripeChargeId,
        baseAmount: booking.payment.baseAmount,
        discountAmount: booking.payment.discountAmount,
        amount: booking.payment.amount,
        currency: booking.payment.currency,
        paymentStatus: booking.payment.paymentStatus,
        paymentDate: booking.payment.paymentDate,
        failureReason: booking.payment.failureReason,

        // ✅ Include Stripe charge details
        stripeChargeDetails: stripeChargeDetails
          ? {
            id: stripeChargeDetails.id,
            amount: stripeChargeDetails.amount / 100,
            currency: stripeChargeDetails.currency,
            status: stripeChargeDetails.status,
            paymentMethod:
              stripeChargeDetails.payment_method_details?.card?.brand,
            last4: stripeChargeDetails.payment_method_details?.card?.last4,
            receiptUrl: stripeChargeDetails.receipt_url,
            fullResponse: stripeChargeDetails,
          }
          : null,
      };
    }

    const formattedLead = {
      id: leadPlain.id,
      parentName: leadPlain.parentName,
      childName: leadPlain.childName,
      age: leadPlain.age,
      postCode: leadPlain.postCode,
      packageInterest: leadPlain.packageInterest,
      availability: leadPlain.availability,
      source: leadPlain.source,
      status: leadPlain.status,
      createdBy: leadPlain.createdBy,
      createdAt: leadPlain.createdAt,
      updatedAt: leadPlain.updatedAt,

      booking: {
        leadId: booking.leadId,
        coachId: booking.coachId,
        coach: booking.coach,
        location: booking.location,
        address: booking.address,
        date: booking.date,
        time: booking.time,
        totalStudents: booking.totalStudents,
        areaWorkOn: booking.areaWorkOn,
        paymentPlanId: booking.paymentPlanId,
        paymentPlan: booking.paymentPlan,
        discountId: booking.discountId,
        students,
        parents,
        emergency,
        payment: paymentObj,
      },
    };

    return { status: true, data: formattedLead };
  } catch (error) {
    console.error("❌ Error fetching one-to-one lead by ID:", error);
    return { status: false, message: error.message };
  }
};

exports.updateOnetoOneLeadById = async (id, adminId, updateData) => {
  const t = await sequelize.transaction();
  try {
    // Step 1: Fetch lead + booking
    const lead = await oneToOneLeads.findOne({
      where: { id, createdBy: adminId },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          include: [
            {
              model: OneToOneStudent,
              as: "students",
              include: [
                { model: OneToOneParent, as: "parentDetails" },
                { model: OneToOneEmergency, as: "emergencyDetails" },
              ],
            },
          ],
        },
      ],
      transaction: t,
    });

    if (!lead) {
      await t.rollback();
      return { status: false, message: "Lead not found or unauthorized." };
    }

    const booking = lead.booking;
    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found for this lead." };
    }

    // ======================================================
    // 🧩 STUDENTS: Add new or update existing
    // ======================================================
    if (Array.isArray(updateData.student) && updateData.student.length) {
      for (const studentData of updateData.student) {
        if (studentData.id) {
          // ✅ Update existing
          const existingStudent = await OneToOneStudent.findOne({
            where: { id: studentData.id, oneToOneBookingId: booking.id },
            transaction: t,
          });
          if (existingStudent) {
            await existingStudent.update(
              {
                studentFirstName:
                  studentData.studentFirstName ??
                  existingStudent.studentFirstName,
                studentLastName:
                  studentData.studentLastName ??
                  existingStudent.studentLastName,
                dateOfBirth:
                  studentData.dateOfBirth ?? existingStudent.dateOfBirth,
                age: studentData.age ?? existingStudent.age,
                gender: studentData.gender ?? existingStudent.gender,
                medicalInfo:
                  studentData.medicalInfo ?? existingStudent.medicalInfo,
              },
              { transaction: t }
            );
          }
        } else {
          // ✅ Create new student
          await OneToOneStudent.create(
            {
              oneToOneBookingId: booking.id,
              studentFirstName: studentData.studentFirstName,
              studentLastName: studentData.studentLastName,
              dateOfBirth: studentData.dateOfBirth,
              age: studentData.age,
              gender: studentData.gender,
              medicalInfo: studentData.medicalInfo,
            },
            { transaction: t }
          );
        }
      }
    }

    // ======================================================
    // 👨‍👩‍👧 PARENTS: Add new or update existing
    // ======================================================
    if (
      Array.isArray(updateData.parentDetails) &&
      updateData.parentDetails.length
    ) {
      for (const parentData of updateData.parentDetails) {
        if (parentData.id) {
          // ✅ Update existing parent
          const existingParent = await OneToOneParent.findOne({
            where: { id: parentData.id },
            transaction: t,
          });

          if (existingParent) {
            await existingParent.update(
              {
                parentFirstName:
                  parentData.parentFirstName ?? existingParent.parentFirstName,
                parentLastName:
                  parentData.parentLastName ?? existingParent.parentLastName,
                parentEmail:
                  parentData.parentEmail ?? existingParent.parentEmail,
                phoneNumber:
                  parentData.phoneNumber ?? existingParent.phoneNumber,
                relationChild:
                  parentData.relationChild ?? existingParent.relationChild,
                howDidHear: parentData.howDidHear ?? existingParent.howDidHear,
              },
              { transaction: t }
            );
          }
        } else if (parentData.oneToOneStudentId) {
          // ✅ Add new parent for a student
          await OneToOneParent.create(
            {
              oneToOneStudentId: parentData.oneToOneStudentId,
              parentFirstName: parentData.parentFirstName,
              parentLastName: parentData.parentLastName,
              parentEmail: parentData.parentEmail,
              phoneNumber: parentData.phoneNumber,
              relationChild: parentData.relationChild,
              howDidHear: parentData.howDidHear,
            },
            { transaction: t }
          );
        }
      }
    }

    // ======================================================
    // 🚨 EMERGENCY DETAILS: Update only
    // ======================================================
    if (updateData.emergencyDetails && updateData.emergencyDetails.id) {
      const e = updateData.emergencyDetails;

      const existingEmergency = await OneToOneEmergency.findOne({
        where: { id: e.id },
        transaction: t,
      });

      if (existingEmergency) {
        await existingEmergency.update(
          {
            emergencyFirstName:
              e.emergencyFirstName ?? existingEmergency.emergencyFirstName,
            emergencyLastName:
              e.emergencyLastName ?? existingEmergency.emergencyLastName,
            phoneNumber: e.phoneNumber ?? existingEmergency.phoneNumber,
            relationChild: e.relationChild ?? existingEmergency.relationChild,
          },
          { transaction: t }
        );
      }
    }

    // ✅ Commit
    await t.commit();

    // ✅ Return updated full data
    const refreshed = await exports.getOnetoOneLeadsById(id, adminId);
    return {
      status: true,
      message: "Lead updated successfully.",
      data: refreshed.data,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ Error updating one-to-one lead:", error);
    return { status: false, message: error.message };
  }
};

// Get All One-to-One Analytics
exports.getAllOneToOneAnalytics = async (superAdminId, adminId) => {
  try {
    // 🗓️ Define date ranges
    const startOfThisMonth = moment().startOf("month").toDate();
    const endOfThisMonth = moment().endOf("month").toDate();
    const startOfLastMonth = moment()
      .subtract(1, "month")
      .startOf("month")
      .toDate();
    const endOfLastMonth = moment()
      .subtract(1, "month")
      .endOf("month")
      .toDate();

    const whereThisMonth = {
      createdBy: adminId,
      createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
    };
    const whereLastMonth = {
      createdBy: adminId,
      createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
    };

    // ✅ Total Leads
    const totalLeadsThisMonth = await oneToOneLeads.count({
      where: whereThisMonth,
    });
    const totalLeadsLastMonth = await oneToOneLeads.count({
      where: whereLastMonth,
    });

    // ✅ Number of Sales (active bookings only)
    const salesThisMonth = await OneToOneBooking.count({
      where: {
        status: "active",
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
    });
    const salesLastMonth = await OneToOneBooking.count({
      where: {
        status: "active",
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
    });

    // ✅ Conversion Rate
    const conversionThisMonth =
      totalLeadsThisMonth > 0
        ? ((salesThisMonth / totalLeadsThisMonth) * 100).toFixed(2)
        : "0.00";
    const conversionLastMonth =
      totalLeadsLastMonth > 0
        ? ((salesLastMonth / totalLeadsLastMonth) * 100).toFixed(2)
        : "0.00";

    // ✅ Revenue Generated
    const paymentsThisMonth = await OneToOnePayment.findAll({
      where: {
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
      attributes: [[fn("SUM", col("amount")), "total"]],
      raw: true,
    });
    const paymentsLastMonth = await OneToOnePayment.findAll({
      where: {
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
      attributes: [[fn("SUM", col("amount")), "total"]],
      raw: true,
    });

    const revenueThisMonth = paymentsThisMonth[0].total || 0;
    const revenueLastMonth = paymentsLastMonth[0].total || 0;
    const packages = ["Gold", "Silver", "Platinum"];

    // ✅ Fetch revenue by package (THIS MONTH)
    const revenueThisMonthRaw = await OneToOnePayment.findAll({
      attributes: [
        [col("booking.lead.packageInterest"), "packageName"],
        [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: oneToOneLeads,
              as: "lead",
              attributes: [],
              where: { packageInterest: { [Op.in]: packages } },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: { createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] } },
      group: ["booking.lead.packageInterest"],
      raw: true,
    });

    // ✅ Fetch revenue by package (LAST MONTH)
    const revenueLastMonthRaw = await OneToOnePayment.findAll({
      attributes: [
        [col("booking.lead.packageInterest"), "packageName"],
        [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: oneToOneLeads,
              as: "lead",
              attributes: [],
              where: { packageInterest: { [Op.in]: packages } },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: { createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] } },
      group: ["booking.lead.packageInterest"],
      raw: true,
    });

    // 🧮 Format into clean summary object
    const revenueByPackageWise = packages.reduce((acc, pkgName) => {
      const current = revenueThisMonthRaw.find(r => r.packageName === pkgName);
      const last = revenueLastMonthRaw.find(r => r.packageName === pkgName);

      acc[pkgName] = {
        thisMonth: parseFloat(current?.totalRevenue || 0).toFixed(2),
        previousMonth: parseFloat(last?.totalRevenue || 0).toFixed(2),
      };

      return acc;
    }, {});

    // ✅ Source Breakdown (Marketing)
    const sourceBreakdown = await oneToOneLeads.findAll({
      attributes: ["source", [fn("COUNT", col("source")), "count"]],
      group: ["source"],
      raw: true,
    });

    // ✅ Top Agents
    const topAgents = await oneToOneLeads.findAll({
      attributes: ["createdBy", [fn("COUNT", col("createdBy")), "leadCount"]],
      group: ["createdBy"],
      include: [
        {
          model: Admin,
          as: "creator",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      order: [[literal("leadCount"), "DESC"]],
      limit: 5,
    });

    // ✅ One-to-One Students (monthly trend: current & last month)
    const monthlyStudents = await OneToOneBooking.findAll({
      attributes: [
        [fn("DATE_FORMAT", col("OneToOneBooking.createdAt"), "%M"), "month"], // e.g. "October"
        [fn("COUNT", col("OneToOneBooking.id")), "bookings"], // total bookings
        [fn("COUNT", fn("DISTINCT", col("students.id"))), "students"], // unique students linked to those bookings
      ],
      include: [
        {
          model: OneToOneStudent,
          as: "students", // ✅ this alias matches your model association
          attributes: [],
          required: true, // inner join ensures bookings with students only
        },
      ],
      where: {
        status: { [Op.in]: ["pending", "active"] },
        createdAt: {
          [Op.between]: [startOfLastMonth, endOfThisMonth],
        },
      },
      group: [fn("MONTH", col("OneToOneBooking.createdAt"))],
      order: [[fn("MONTH", col("OneToOneBooking.createdAt")), "ASC"]],
      raw: true,
    });
    const packageBreakdown = await oneToOneLeads.findAll({
      attributes: [
        ["packageInterest", "packageName"], // e.g., Gold / Silver / Platinum
        [fn("COUNT", col("packageInterest")), "count"],
      ],
      where: {
        packageInterest: { [Op.in]: ["Gold", "Silver", "Platinum"] },
      },
      group: ["packageInterest"],
      raw: true,
    });

    // 🧮 Total Count (for percentages)
    const totalPackages = packageBreakdown.reduce(
      (sum, pkg) => sum + parseInt(pkg.count, 10),
      0
    );

    // 🧠 Format data for frontend donut chart
    const formattedPackages = packageBreakdown.map(pkg => {
      const count = parseInt(pkg.count, 10);
      const percentage = totalPackages > 0 ? ((count / totalPackages) * 100).toFixed(2) : 0;
      return {
        name: pkg.packageName,           // Gold / Silver / Platinum
        value: parseFloat((count / 1000).toFixed(3)), // e.g. 1.235 (mock scaling)
        percentage: parseFloat(percentage),           // e.g. 25.00
      };
    });

    // 🧩 Add booking data to the same months for comparison
    const monthlyBookings = await OneToOneBooking.findAll({
      attributes: [
        [fn("DATE_FORMAT", col("createdAt"), "%M"), "month"],
        [fn("COUNT", col("id")), "bookings"],
      ],
      where: {
        createdAt: {
          [Op.between]: [startOfLastMonth, endOfThisMonth],
        },
      },
      group: [fn("MONTH", col("createdAt"))],
      raw: true,
    });

    // 🧠 Merge students and bookings into one unified array
    const mergedMonthlyData = ["lastMonth", "thisMonth"]
      .map((_, i) => {
        const monthName = moment().subtract(1 - i, "month").format("MMMM");
        const studentData = monthlyStudents.find((s) => s.month === monthName);
        const bookingData = monthlyBookings.find((b) => b.month === monthName);
        return {
          month: monthName,
          students: studentData ? parseInt(studentData.students) : 0,
          bookings: bookingData ? parseInt(bookingData.bookings) : 0,
        };
      });

    // ✅ Renewal Breakdown (Gold, Silver, Platinum)
    const renewalBreakdownRaw = await OneToOneBooking.findAll({
      attributes: [
        [col("lead.packageInterest"), "packageName"], // join with lead’s package
        [fn("COUNT", col("OneToOneBooking.id")), "count"],
      ],
      include: [
        {
          model: oneToOneLeads,
          as: "lead", // 👈 must match association alias in OneToOneBooking model
          attributes: [],
          where: {
            packageInterest: { [Op.in]: ["Gold", "Silver", "Platinum"] },
          },
          required: true,
        },
      ],
      group: ["lead.packageInterest"],
      raw: true,
    });

    // 🧮 Calculate total renewals
    const totalRenewals = renewalBreakdownRaw.reduce(
      (sum, r) => sum + parseInt(r.count, 10),
      0
    );

    // 🧠 Format for frontend (progress bar chart)
    const renewalBreakdown = ["Gold", "Silver", "Platinum"].map(pkgName => {
      const found = renewalBreakdownRaw.find(r => r.packageName === pkgName);
      const count = found ? parseInt(found.count, 10) : 0;
      const percentage =
        totalRenewals > 0 ? ((count / totalRenewals) * 100).toFixed(2) : 0;

      return {
        name: pkgName,
        count,
        percentage: parseFloat(percentage),
      };
    });

    // ✅ Revenue by Package (Current Month)
    const revenueByPackageRaw = await OneToOnePayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: OneToOneBooking,
          as: "booking", // must match your OneToOnePayment association
          attributes: [],
          include: [
            {
              model: oneToOneLeads,
              as: "lead", // must match your OneToOneBooking association alias
              attributes: [],
              where: {
                packageInterest: { [Op.in]: ["Gold", "Silver", "Platinum"] },
              },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    // ✅ Revenue by Package (Last Month)
    const revenueByPackageLastMonth = await OneToOnePayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: oneToOneLeads,
              as: "lead",
              attributes: [],
              where: {
                packageInterest: { [Op.in]: ["Gold", "Silver", "Platinum"] },
              },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    // 🧮 Combine and calculate growth %
    const revenueByPackage = ["Gold", "Silver", "Platinum"].map(pkgName => {
      const current = revenueByPackageRaw.find(r => r.packageName === pkgName);
      const last = revenueByPackageLastMonth.find(r => r.packageName === pkgName);

      const currentRevenue = current ? parseFloat(current.totalRevenue || 0) : 0;
      const lastRevenue = last ? parseFloat(last.totalRevenue || 0) : 0;

      const growth =
        lastRevenue > 0
          ? (((currentRevenue - lastRevenue) / lastRevenue) * 100).toFixed(2)
          : currentRevenue > 0
            ? 100
            : 0;

      return {
        name: pkgName,
        currentRevenue,
        lastRevenue,
        revenueGrowth: parseFloat(growth),
      };
    });
    // ✅ Marketing Channel Performance
    const marketChannelRaw = await oneToOneLeads.findAll({
      attributes: [
        "source",
        [fn("COUNT", col("source")), "count"],
      ],
      where: {
        source: { [Op.ne]: null }, // exclude leads without source
      },
      group: ["source"],
      raw: true,
    });

    // 🧮 Calculate total leads for percentage
    const totalSources = marketChannelRaw.reduce(
      (sum, s) => sum + parseInt(s.count, 10),
      0
    );

    // 🧠 Format data for frontend (progress bar UI)
    const marketChannelPerformance = marketChannelRaw.map(s => {
      const count = parseInt(s.count, 10);
      const percentage = totalSources > 0 ? ((count / totalSources) * 100).toFixed(2) : 0;

      return {
        name: s.source,           // e.g. "Facebook"
        count,                    // e.g. 23456
        percentage: parseFloat(percentage), // e.g. 50.00
      };
    });

    // ✅ Final Structured Response (matches Figma)
    return {
      status: true,
      message: "Fetched One-to-One analytics successfully.",
      summary: {
        totalLeads: {
          thisMonth: totalLeadsThisMonth,
          previousMonth: totalLeadsLastMonth,
        },
        numberOfSales: {
          thisMonth: salesThisMonth,
          previousMonth: salesLastMonth,
        },
        conversionRate: {
          thisMonth: `${conversionThisMonth}%`,
          previousMonth: `${conversionLastMonth}%`,
        },
        revenueGenerated: {
          thisMonth: revenueThisMonth,
          previousMonth: revenueLastMonth,
        },
      },
      charts: {
        monthlyStudents: mergedMonthlyData, // for line chart
        // revenueByPackage, // donut chart
        marketChannelPerformance,
        sourceBreakdown, // marketing channels
        topAgents, // top agents
        renewalBreakdown, // renewal chart
        packageBreakdown: formattedPackages,
        revenueByPackage
      },
    };
  } catch (error) {
    console.error("❌ Error fetching One-to-One analytics:", error);
    return { status: false, message: error.message };
  }
};
