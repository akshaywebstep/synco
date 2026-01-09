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
const { Op, fn, col, literal, Sequelize } = require("sequelize");
// Helper to calculate percentage change average
function calculateAverage(current, previous) {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100; // or +Infinity, decide how to handle no previous data
  return Math.round(((current - previous) / previous) * 100);
}
const useOrDefault = (data, fallback) =>
  Array.isArray(data) && data.length > 0 ? data : fallback;

const stripePromise = require("../../../utils/payment/pay360/stripe");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
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

exports.assignBookingsToAgent = async ({ leadIds, createdBy }) => {
  const t = await sequelize.transaction();

  try {
    // ✅ Validation
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      throw new Error("At least one lead ID is required");
    }

    if (!createdBy || isNaN(Number(createdBy))) {
      throw new Error("Valid agent ID is required");
    }

    // ✅ Check agent exists
    const agent = await Admin.findByPk(createdBy, { transaction: t });
    if (!agent) {
      throw new Error("Agent not found");
    }

    // ✅ Fetch leads (parentName already exists here)
    const leads = await oneToOneLeads.findAll({
      where: {
        id: { [Op.in]: leadIds },
      },
      attributes: ["id", "parentName", "createdBy"],
      transaction: t,
    });

    if (leads.length !== leadIds.length) {
      throw new Error("One or more leads were not found");
    }

    // ✅ Check already assigned leads
    const alreadyAssigned = leads.filter(
      (lead) => lead.createdBy !== null
    );

    if (alreadyAssigned.length > 0) {
      const names = alreadyAssigned
        .map((lead) => lead.parentName || "Unknown Parent")
        .join(", ");

      throw new Error(`${names} lead already assigned`);
    }

    // ✅ Assign agent
    await oneToOneLeads.update(
      {
        createdBy,
        updatedAt: new Date(),
      },
      {
        where: {
          id: { [Op.in]: leadIds },
        },
        transaction: t,
      }
    );

    await t.commit();

    return {
      status: true,
      message: "Leads successfully assigned to agent",
      data: {
        leadIds,
        createdBy,
        totalAssigned: leadIds.length,
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
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      whereLead[Op.or] = [
        { createdBy: { [Op.in]: adminIds } },
        { createdBy: null },
      ];
    } else if (superAdminId && adminId) {
      whereLead[Op.or] = [
        { createdBy: { [Op.in]: [adminId, superAdminId] } },
        { createdBy: null },
      ];
    } else {
      whereLead[Op.or] = [
        { createdBy: adminId },
        { createdBy: null },
      ];
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

    // ✅ Support multiple types (e.g. "paid,trial" or array)
    if (type) {
      let types = [];

      if (Array.isArray(type)) {
        // e.g. type=['paid','trial']
        types = type.map((t) => t.toLowerCase());
      } else if (typeof type === "string") {
        // e.g. type='paid'
        types = [type.toLowerCase()];
      }

      if (types.length > 0) {
        whereBooking.type = { [Op.in]: types };
      }
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
                {
                  model: OneToOneEmergency, as: "emergencyDetails", attributes: [
                    "id",
                    "studentId",
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation"
                  ],
                },

              ],
            },
            { model: OneToOnePayment, as: "payment" },
            { model: Admin, as: "coach" },
          ],
        },
      ],
    });

    // ✅ Optional student name filter
    let filteredLeads = leads;
    if (studentName) {
      const nameFilter = studentName.toLowerCase().trim();

      filteredLeads = leads.filter((lead) => {
        const booking = lead.booking;
        if (!booking || !booking.students) return false;

        return booking.students.some((s) => {
          const first = s.studentFirstName?.toLowerCase() || "";
          const last = s.studentLastName?.toLowerCase() || "";
          const full = `${first} ${last}`.trim();

          return (
            first.includes(nameFilter) ||
            last.includes(nameFilter) ||
            full.includes(nameFilter)
          );
        });
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
            emergencyPhoneNumber: emergencyObj.emergencyPhoneNumber,
            emergencyRelation: emergencyObj.emergencyRelation,
          }
          : null;

        let paymentObj = null;
        if (booking.payment) {
          const stripeChargeId = booking.payment.stripePaymentIntentId;
          let stripeChargeDetails = null;

          if (stripeChargeId) {
            try {
              // ✅ Wait for Stripe to be ready
              const stripe = await stripePromise;

              if (stripeChargeId.startsWith("pi_")) {
                // 🔹 Retrieve PaymentIntent and expand to get latest charge
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
                // 🔹 Retrieve charge directly
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
            coach: booking.coach,
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

    // In your existing function, after filters and data fetching, replace the summary block with:

    // Helper to calculate percentage change between current and previous values
    function calculateAverage(current, previous) {
      if (previous === 0 && current === 0) return 0;
      if (previous === 0) return 100; // or choose some other logic if no previous data
      const change = ((current - previous) / previous) * 100;
      return Math.round(change);
    }

    // Your date ranges
    const startOfThisYear = moment().startOf("year").toDate();
    const endOfThisYear = moment().endOf("year").toDate();

    const startOfLastYear = moment().subtract(1, "year").startOf("year").toDate();
    const endOfLastYear = moment().subtract(1, "year").endOf("year").toDate();

    const startOfThisMonth = moment().startOf("month").toDate();
    const endOfThisMonth = moment().endOf("month").toDate();

    const startOfLastMonth = moment().subtract(1, "month").startOf("month").toDate();
    const endOfLastMonth = moment().subtract(1, "month").endOf("month").toDate();

    // Base where for leads
    const baseWhere = { status: "pending" };
    if (superAdminId && superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      baseWhere[Op.or] = [
        { createdBy: { [Op.in]: adminIds } },
        { createdBy: null }
      ];
    } else {
      baseWhere[Op.or] = [
        { createdBy: { [Op.in]: [adminId, superAdminId] } },
        { createdBy: null }
      ];
    }

    // 1. totalLeads: leads WITHOUT booking in current year
    const totalLeadsThisYear = await oneToOneLeads.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] },
      },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: false,
          where: { id: null }, // no booking
        },
      ],
    });

    const totalLeadsLastYear = await oneToOneLeads.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfLastYear, endOfLastYear] },
      },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: false,
          where: { id: null }, // no booking
        },
      ],
    });

    const totalLeadsAverage = calculateAverage(totalLeadsThisYear, totalLeadsLastYear);

    // 2. newLeads: leads created THIS MONTH
    const newLeadsThisMonth = await oneToOneLeads.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
    });

    const newLeadsLastMonth = await oneToOneLeads.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
    });

    const newLeadsAverage = calculateAverage(newLeadsThisMonth, newLeadsLastMonth);

    // 3. leadsWithBookings: leads WITH booking in current year
    const leadsWithBookingsThisYear = await oneToOneLeads.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] },
      },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          where: { status: "pending" },
        },
      ],
    });

    const leadsWithBookingsLastYear = await oneToOneLeads.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfLastYear, endOfLastYear] },
      },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          where: { status: "pending" },
        },
      ],
    });

    const leadsWithBookingsAverage = calculateAverage(leadsWithBookingsThisYear, leadsWithBookingsLastYear);

    // 4. sourceOfBookings (grouped)
    const sourceCount = await oneToOneLeads.findAll({
      where: baseWhere,
      attributes: [
        "source",
        [sequelize.fn("COUNT", sequelize.col("source")), "count"],
      ],
      group: ["source"],
    });

    // Build summary object (keys unchanged)
    const summary = {
      totalLeads: {
        count: totalLeadsThisYear,
        average: totalLeadsAverage > 0 ? `+${totalLeadsAverage}%` : `${totalLeadsAverage}%`,
      },
      newLeads: {
        count: newLeadsThisMonth,
        average: newLeadsAverage > 0 ? `+${newLeadsAverage}%` : `${newLeadsAverage}%`,
      },
      leadsWithBookings: {
        count: leadsWithBookingsThisYear,
        average: leadsWithBookingsAverage > 0 ? `+${leadsWithBookingsAverage}%` : `${leadsWithBookingsAverage}%`,
      },
      sourceOfBookings: sourceCount.map((src) => ({
        source: src.source,
        count: Number(src.get("count")),
      })),
    };

    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary,
      };
    }

    return {
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary,
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

    const {
      fromDate,
      toDate,
      type,
      studentName,
      agent,
      coach,
      packageInterest,
      source,
      location,
    } = filters;

    const whereLead = { status: "active" };
    const whereBooking = { status: "active" };

    // ✅ Super Admin → all admins under them (including self)
    if (superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId); // include the super admin
      whereLead.createdBy = { [Op.in]: adminIds };
    } else {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);  // include super admin
      adminIds.push(adminId);       // include current admin

      whereLead.createdBy = { [Op.in]: adminIds };
    }

    // ✅ Date filter
    if (fromDate && toDate) {
      whereLead.createdAt = {
        [Op.between]: [
          moment(fromDate, "YYYY-MM-DD").startOf("day").toDate(),
          moment(toDate, "YYYY-MM-DD").endOf("day").toDate(),
        ],
      };
    }
    // ✅ Type filter
    if (type) {
      whereBooking.type = { [Op.eq]: type.toLowerCase() };
    }
    if (location) {
      whereBooking.location = { [Op.eq]: location };
    }

    // ✅ Agent filter
    if (agent) {
      let agentIds = [];

      if (Array.isArray(agent)) {
        // Handles ?agent=1&agent=6
        agentIds = agent.map((id) => Number(id)).filter(Boolean);
      } else if (typeof agent === "string") {
        // Handles ?agent=1,6
        agentIds = agent
          .split(",")
          .map((id) => Number(id.trim()))
          .filter(Boolean);
      }

      if (agentIds.length > 0) {
        whereLead.createdBy = { [Op.in]: agentIds };
        console.log("🧩 Agent filter applied:", agentIds);
      }
    }

    // ✅ Coach filter
    if (coach) {
      let coachIds = [];

      if (Array.isArray(coach)) {
        // Handles ?coach=2&coach=5
        coachIds = coach.map((id) => Number(id)).filter(Boolean);
      } else if (typeof coach === "string") {
        // Handles ?coach=2,5
        coachIds = coach
          .split(",")
          .map((id) => Number(id.trim()))
          .filter(Boolean);
      }

      if (coachIds.length > 0) {
        whereBooking.coachId = { [Op.in]: coachIds };
        console.log("🧩 Coach filter applied:", coachIds);
      }
    }

    // ✅ Source filter
    if (source) {
      whereLead.source = { [Op.eq]: source.toLowerCase() };
    }

    // ✅ Package Interest filter
    if (packageInterest) {
      whereLead.packageInterest = { [Op.eq]: packageInterest.toLowerCase() };
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
                {
                  model: OneToOneEmergency, as: "emergencyDetails", attributes: [
                    "id",
                    "studentId",
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation"
                  ],
                },
              ],
            },
            { model: OneToOnePayment, as: "payment" },
            { model: PaymentPlan, as: "paymentPlan" },
            { model: Admin, as: "coach" },
          ],
        },
      ],
    });

    // 🧠 Optional Student Name Filter
    let filteredLeads = leads;
    if (studentName) {
      const nameFilter = studentName.toLowerCase().trim();

      filteredLeads = leads.filter((lead) => {
        const booking = lead.booking;
        if (!booking || !booking.students) return false;

        return booking.students.some((s) => {
          const first = s.studentFirstName?.toLowerCase() || "";
          const last = s.studentLastName?.toLowerCase() || "";
          const full = `${first} ${last}`.trim();

          return (
            first.includes(nameFilter) ||
            last.includes(nameFilter) ||
            full.includes(nameFilter)
          );
        });
      });
    }

    if (location) {
      filteredLeads = filteredLeads.filter((lead) => {
        const booking = lead.booking;
        if (!booking) return false;

        return (
          booking.location &&
          booking.location.toLowerCase().includes(location.toLowerCase())
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
            emergencyPhoneNumber: emergencyObj.emergencyPhoneNumber,
            emergencyRelationChild: emergencyObj.emergencyRelationChild,
          }
          : null;

        // Payment + Stripe charge details
        let paymentObj = null;
        if (booking.payment) {
          const stripeChargeId = booking.payment.stripePaymentIntentId;
          let stripeChargeDetails = null;

          if (stripeChargeId) {
            try {
              // ✅ Wait for Stripe to be ready
              const stripe = await stripePromise;

              if (stripeChargeId.startsWith("pi_")) {
                // 🔹 Retrieve PaymentIntent and expand to get latest charge
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
                // 🔹 Retrieve charge directly
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
            coach: booking.coach,
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

    const startOfThisMonth = moment().startOf("month").toDate();
    const endOfThisMonth = moment().endOf("month").toDate();

    const startOfLastMonth = moment().subtract(1, "month").startOf("month").toDate();
    const endOfLastMonth = moment().subtract(1, "month").endOf("month").toDate();

    const percent = (curr, prev) => {
      if (!prev) return "+100%";
      const val = Math.round(((curr - prev) / prev) * 100);
      return `${val >= 0 ? "+" : ""}${val}%`;
    };

    const totalRevenueThisMonth = await OneToOnePayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
    });

    const totalRevenueLastMonth = await OneToOnePayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
    });

    const getSourceRevenue = async (packageInterest, start, end) => {
      return await OneToOnePayment.sum("amount", {
        include: [
          {
            model: OneToOneBooking,
            as: "booking",
            required: true,
            include: [
              {
                model: oneToOneLeads,
                as: "lead",
                required: true,
                where: {
                  packageInterest, // gold / silver
                  createdAt: {
                    [Op.between]: [start, end], // ✅ DATE FILTER HERE
                  },
                },
              },
            ],
          },
        ],
        where: {
          paymentStatus: "paid", // ✅ only successful payments
        },
      });
    };

    const goldThisMonth = await getSourceRevenue("gold", startOfThisMonth, endOfThisMonth);
    const goldLastMonth = await getSourceRevenue("gold", startOfLastMonth, endOfLastMonth);
    const silverThisMonth = await getSourceRevenue("silver", startOfThisMonth, endOfThisMonth);
    const silverLastMonth = await getSourceRevenue("silver", startOfLastMonth, endOfLastMonth);
    const topSalesAgent = await oneToOneLeads.findOne({
      attributes: [
        "createdBy",
        [sequelize.fn("COUNT", sequelize.col("OneToOneLead.id")), "leadCount"],
      ],
      where: {
        status: "active",
      },
      include: [
        {
          model: Admin,
          as: "creator",
          attributes: ["firstName", "lastName"],
        },
      ],
      group: ["OneToOneLead.createdBy", "creator.id"],
      order: [[sequelize.literal("leadCount"), "DESC"]],
      subQuery: false,
    });

    const topAgent = topSalesAgent
      ? {
        name: `${topSalesAgent.creator.firstName} ${topSalesAgent.creator.lastName}`,
        totalLeads: Number(topSalesAgent.get("leadCount")),
      }
      : null;
    const summary = {
      totalRevenue: {
        amount: Number(totalRevenueThisMonth || 0),
        percentage: percent(totalRevenueThisMonth || 0, totalRevenueLastMonth || 0),
      },
      goldPackageRevenue: {
        amount: Number(goldThisMonth || 0),
        percentage: percent(goldThisMonth || 0, goldLastMonth || 0),
      },
      silverPackageRevenue: {
        amount: Number(silverThisMonth || 0),
        percentage: percent(silverThisMonth || 0, silverLastMonth || 0),
      },
      topSalesAgent: topAgent,
    };

    // ----------------------------------------------------------------------
    // Agent List (same logic)
    // ----------------------------------------------------------------------
    let agentList = [];

    // CASE 1: super admin → include self + managed admins
    if (superAdminId && superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id", "firstName", "lastName", "email"],
      });

      agentList = managedAdmins.map(a => ({
        id: a.id,
        name: `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.email,
      }));

      const superAdmin = await Admin.findByPk(superAdminId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });

      if (superAdmin) {
        agentList.unshift({
          id: superAdmin.id,
          name:
            `${superAdmin.firstName || ""} ${superAdmin.lastName || ""}`.trim() ||
            superAdmin.email,
        });
      }

      // CASE 2: normal admin
    } else {
      const admin = await Admin.findByPk(adminId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });

      if (admin) {
        agentList.push({
          id: admin.id,
          name:
            `${admin.firstName || ""} ${admin.lastName || ""}`.trim() ||
            admin.email,
        });
      }
    }

    // 🔥 HARD GUARANTEE: NEVER return empty agentList
    if (!agentList || agentList.length === 0) {
      const fallbackAdmins = await Admin.findAll({
        where: { id: adminId },
        attributes: ["id", "firstName", "lastName", "email"],
      });

      agentList = fallbackAdmins.map(a => ({
        id: a.id,
        name: `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.email,
      }));
    }

    // ----------------------------------------------------------------------
    // Coach List
    // ----------------------------------------------------------------------
    const coachIds = [
      ...new Set(
        formattedData
          .map((lead) => lead.booking?.coachId)
          .filter(Boolean)
      ),
    ];

    let coachList = [];

    if (coachIds.length > 0) {
      const coaches = await Admin.findAll({
        where: { id: { [Op.in]: coachIds } },
        attributes: ["id", "firstName", "lastName", "email"],
      });

      coachList = coaches.map((c) => ({
        id: c.id,
        name:
          `${c.firstName || ""} ${c.lastName || ""}`.trim() ||
          c.email,
      }));
    }

    // ✅ Final Response
    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary,
        coachList,
        agentList,
      };
    }

    return {
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary,
      locations,
      locationSummary,
      coachList,
      agentList,
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

    const {
      fromDate,
      toDate,
      type,
      studentName,
      packageInterest,
      source,
      coach,
      agent,
      location,
    } = filters;

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
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);  // include super admin
      adminIds.push(adminId);       // include current admin

      whereLead.createdBy = { [Op.in]: adminIds };
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

    // ✅ Package Interest filter
    if (packageInterest) {
      whereLead.packageInterest = { [Op.eq]: packageInterest };
    }

    // ✅ Source filter
    if (source) {
      whereLead.source = { [Op.eq]: source.toLowerCase() };
    }

    // ✅ Agent filter
    if (agent) {
      let agentIds = [];

      if (Array.isArray(agent)) {
        // Handles ?agent=1&agent=6
        agentIds = agent.map((id) => Number(id)).filter(Boolean);
      } else if (typeof agent === "string") {
        // Handles ?agent=1,6
        agentIds = agent
          .split(",")
          .map((id) => Number(id.trim()))
          .filter(Boolean);
      }

      if (agentIds.length > 0) {
        whereLead.createdBy = { [Op.in]: agentIds };
        console.log("🧩 Agent filter applied:", agentIds);
      }
    }

    // ✅ Coach filter
    if (coach) {
      let coachIds = [];

      if (Array.isArray(coach)) {
        // Handles ?coach=2&coach=5
        coachIds = coach.map((id) => Number(id)).filter(Boolean);
      } else if (typeof coach === "string") {
        // Handles ?coach=2,5
        coachIds = coach
          .split(",")
          .map((id) => Number(id.trim()))
          .filter(Boolean);
      }

      if (coachIds.length > 0) {
        whereBooking.coachId = { [Op.in]: coachIds };
        console.log("🧩 Coach filter applied:", coachIds);
      }
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
          required: true,
          // still only strict join when filtering by type
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
                {
                  model: OneToOneEmergency, as: "emergencyDetails", attributes: [
                    "id",
                    "studentId",
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation"
                  ],
                },
              ],
            },
            { model: OneToOnePayment, as: "payment" },
            { model: PaymentPlan, as: "paymentPlan" },
            { model: Admin, as: "coach" },
          ],
        },
      ],
    });

    // 🧠 Optional Student Name Filter
    let filteredLeads = leads;
    if (studentName) {
      const nameFilter = studentName.toLowerCase().trim();

      filteredLeads = leads.filter((lead) => {
        const booking = lead.booking;
        if (!booking || !booking.students) return false;

        return booking.students.some((s) => {
          const first = s.studentFirstName?.toLowerCase() || "";
          const last = s.studentLastName?.toLowerCase() || "";
          const full = `${first} ${last}`.trim();

          return (
            first.includes(nameFilter) ||
            last.includes(nameFilter) ||
            full.includes(nameFilter)
          );
        });
      });
    }

    if (location) {
      filteredLeads = filteredLeads.filter((lead) => {
        const booking = lead.booking;
        if (!booking) return false;

        return (
          booking.location &&
          booking.location.toLowerCase().includes(location.toLowerCase())
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
            emergencyPhoneNumber: emergencyObj.emergencyPhoneNumber,
            emergencyRelation: emergencyObj.emergencyRelation,
          }
          : null;

        // Payment + Stripe charge details
        let paymentObj = null;
        if (booking.payment) {
          const stripeChargeId = booking.payment.stripePaymentIntentId;
          let stripeChargeDetails = null;

          if (stripeChargeId) {
            try {
              // ✅ Wait for Stripe to be ready
              const stripe = await stripePromise;

              if (stripeChargeId.startsWith("pi_")) {
                // 🔹 Retrieve PaymentIntent and expand to get latest charge
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
                // 🔹 Retrieve charge directly
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
            coach: booking.coach,
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
    const startOfThisMonth = moment().startOf("month").toDate();
    const endOfThisMonth = moment().endOf("month").toDate();

    const startOfLastMonth = moment().subtract(1, "month").startOf("month").toDate();
    const endOfLastMonth = moment().subtract(1, "month").endOf("month").toDate();

    const percent = (curr, prev) => {
      if (!prev) return "+100%";
      const val = Math.round(((curr - prev) / prev) * 100);
      return `${val >= 0 ? "+" : ""}${val}%`;
    };

    const totalRevenueThisMonth = await OneToOnePayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
    });

    const totalRevenueLastMonth = await OneToOnePayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
    });

    const getSourceRevenue = async (packageInterest, start, end) => {
      return await OneToOnePayment.sum("amount", {
        include: [
          {
            model: OneToOneBooking,
            as: "booking",
            required: true,
            include: [
              {
                model: oneToOneLeads,
                as: "lead",
                required: true,
                where: {
                  packageInterest, // gold / silver
                  createdAt: {
                    [Op.between]: [start, end], // ✅ DATE FILTER HERE
                  },
                },
              },
            ],
          },
        ],
        where: {
          paymentStatus: "paid", // ✅ only successful payments
        },
      });
    };

    const goldThisMonth = await getSourceRevenue("gold", startOfThisMonth, endOfThisMonth);
    const goldLastMonth = await getSourceRevenue("gold", startOfLastMonth, endOfLastMonth);

    const silverThisMonth = await getSourceRevenue("silver", startOfThisMonth, endOfThisMonth);
    const silverLastMonth = await getSourceRevenue("silver", startOfLastMonth, endOfLastMonth);

    const topSalesAgent = await oneToOneLeads.findOne({
      attributes: [
        "createdBy",
        [sequelize.fn("COUNT", sequelize.col("OneToOneLead.id")), "leadCount"],
      ],
      where: {
        status: "active",
      },
      include: [
        {
          model: Admin,
          as: "creator",
          attributes: ["firstName", "lastName"],
        },
      ],
      group: ["OneToOneLead.createdBy", "creator.id"],
      order: [[sequelize.literal("leadCount"), "DESC"]],
      subQuery: false,
    });

    const topAgent = topSalesAgent
      ? {
        name: `${topSalesAgent.creator.firstName} ${topSalesAgent.creator.lastName}`,
        totalLeads: Number(topSalesAgent.get("leadCount")),
      }
      : null;
    const summary = {
      totalRevenue: {
        amount: Number(totalRevenueThisMonth || 0),
        percentage: percent(totalRevenueThisMonth || 0, totalRevenueLastMonth || 0),
      },
      goldPackageRevenue: {
        amount: Number(goldThisMonth || 0),
        percentage: percent(goldThisMonth || 0, goldLastMonth || 0),
      },
      silverPackageRevenue: {
        amount: Number(silverThisMonth || 0),
        percentage: percent(silverThisMonth || 0, silverLastMonth || 0),
      },
      topSalesAgent: topAgent,
    };

    // ----------------------------------------------------------------------
    // Agent List (super admin + managed admins)
    // ----------------------------------------------------------------------
    let agentList = [];

    if (superAdminId === adminId) {
      // Fetch all admins under this super admin
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id", "firstName", "lastName", "email"],
      });

      agentList = managedAdmins.map((admin) => ({
        id: admin.id,
        name:
          `${admin.firstName || ""} ${admin.lastName || ""}`.trim() ||
          admin.email,
      }));

      // Include the super admin at the top
      const superAdmin = await Admin.findByPk(superAdminId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });

      if (superAdmin) {
        agentList.unshift({
          id: superAdmin.id,
          name:
            `${superAdmin.firstName || ""} ${superAdmin.lastName || ""}`.trim() ||
            superAdmin.email,
        });
      }
    } else {
      // Normal admin
      const admin = await Admin.findByPk(adminId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });

      if (admin) {
        agentList.push({
          id: admin.id,
          name:
            `${admin.firstName || ""} ${admin.lastName || ""}`.trim() ||
            admin.email,
        });
      }
    }

    // 🔥 FINAL FALLBACK: Ensure agentList is NEVER empty
    if (agentList.length === 0) {
      const admin = await Admin.findByPk(adminId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });

      if (admin) {
        agentList = [
          {
            id: admin.id,
            name:
              `${admin.firstName || ""} ${admin.lastName || ""}`.trim() ||
              admin.email,
          },
        ];
      }
    }

    // ----------------------------------------------------------------------
    // Coach List (from formattedData)
    // ----------------------------------------------------------------------
    const coachIds = [
      ...new Set(
        formattedData
          .map((lead) => lead.booking?.coachId)
          .filter(Boolean)
      ),
    ];

    let coachList = [];

    if (coachIds.length > 0) {
      const coaches = await Admin.findAll({
        where: { id: { [Op.in]: coachIds } },
        attributes: ["id", "firstName", "lastName", "email"],
      });

      coachList = coaches.map((coach) => ({
        id: coach.id,
        name:
          `${coach.firstName || ""} ${coach.lastName || ""}`.trim() ||
          coach.email,
      }));
    }

    // 🔥 FINAL FALLBACK: Ensure coachList is NEVER empty
    if (coachList.length === 0) {
      coachList = [{ id: null, name: "No Coach Assigned" }];
    }

    // ✅ Final Response
    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary,
        agentList,
        coachList,
      };
    }

    return {
      status: true,
      message: "Fetched One-to-One leads successfully.",
      summary,
      locations,
      locationSummary,
      agentList,
      coachList,
      data: formattedData,
    };
  } catch (error) {
    console.error("❌ Error fetching oneToOne leads:", error);
    return { status: false, message: error.message };
  }
};

exports.getOnetoOneLeadsById = async (id, superAdminId, adminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    // ✅ Declare whereLead object
    const whereLead = {};

    // ✅ If user is Super Admin — show all leads for their managed admins + self
    if (superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId); // include the super admin themselves

      whereLead.createdBy = { [Op.in]: adminIds };
    } else {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);  // include super admin
      adminIds.push(adminId);       // include current admin

      whereLead.createdBy = { [Op.in]: adminIds };
    }

    // ✅ Merge whereLead into the query
    const lead = await oneToOneLeads.findOne({
      where: { id, ...whereLead },
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
                {
                  model: OneToOneEmergency, as: "emergencyDetails", attributes: [
                    "id",
                    "studentId",
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation"
                  ],
                },
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

    // 🧩 Students
    const students =
      booking.students?.map((student) => ({
        id: student.id,
        studentFirstName: student.studentFirstName,
        studentLastName: student.studentLastName,
        dateOfBirth: student.dateOfBirth,
        age: student.age,
        gender: student.gender,
        medicalInfo: student.medicalInfo,
      })) || [];

    // 🧩 Parents for all students
    const parents =
      booking.students?.flatMap((student) => {
        const parentArr = Array.isArray(student.parentDetails)
          ? student.parentDetails
          : student.parentDetails
            ? [student.parentDetails] // wrap single object into array
            : [];

        return parentArr.map((parent) => ({
          id: parent.id,
          studentId: student.id, // link to correct student
          parentFirstName: parent.parentFirstName,
          parentLastName: parent.parentLastName,
          parentEmail: parent.parentEmail,
          phoneNumber: parent.phoneNumber,
          relationChild: parent.relationChild,
          howDidHear: parent.howDidHear,
        }));
      }) || [];

    // 🧩 Get emergency contact (take first found)
    const emergency =
      booking.students?.flatMap(
        (student) =>
          (Array.isArray(student.emergencyDetails)
            ? student.emergencyDetails
            : student.emergencyDetails
              ? [student.emergencyDetails]
              : []
          ).map((em) => ({
            id: em.id,
            emergencyFirstName: em.emergencyFirstName,
            emergencyLastName: em.emergencyLastName,
            emergencyPhoneNumber: em.emergencyPhoneNumber,
            emergencyRelation: em.emergencyRelation,
          }))
      )?.[0] || null;

    // 💳 Payment + Stripe details
    let paymentObj = null;
    if (booking.payment) {
      const stripeChargeId = booking.payment.stripePaymentIntentId;
      let stripeChargeDetails = null;

      if (stripeChargeId) {
        try {
          // ✅ Wait for Stripe to be ready
          const stripe = await stripePromise;

          if (stripeChargeId.startsWith("pi_")) {
            // 🔹 Retrieve PaymentIntent and expand to get latest charge
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
            // 🔹 Retrieve charge directly
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
        id: booking.id,
        leadId: booking.leadId,
        coachId: booking.coachId,
        serviceType: booking.serviceType,
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
        createdAt: booking.createdAt,
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

exports.updateOnetoOneLeadById = async (id, superAdminId, adminId, updateData) => {
  const t = await sequelize.transaction();
  try {

    const lead = await oneToOneLeads.findOne({
      where: {
        id,
        [Op.or]: [{ createdBy: adminId }, { createdBy: superAdminId }]
      },
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
                {
                  model: OneToOneEmergency, as: "emergencyDetails", attributes: [
                    "id",
                    "studentId",
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation"
                  ],
                },
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
    let adminSynced = false;

    // ======================================================
    // 🧩 STUDENTS (STRICT VALIDATION)
    // ======================================================
    if (Array.isArray(updateData?.student)) {
      for (const s of updateData.student) {

        // ---------- UPDATE ----------
        if (s.id) {
          const existingStudent = await OneToOneStudent.findOne({
            where: { id: s.id, oneToOneBookingId: booking.id },
            transaction: t,
          });
          if (!existingStudent) continue;

          await existingStudent.update(
            {
              studentFirstName: s.studentFirstName ?? existingStudent.studentFirstName,
              studentLastName: s.studentLastName ?? existingStudent.studentLastName,
              dateOfBirth: s.dateOfBirth ?? existingStudent.dateOfBirth,
              age: s.age ?? existingStudent.age,
              gender: s.gender ?? existingStudent.gender,
              medicalInfo: s.medicalInfo ?? existingStudent.medicalInfo,
            },
            { transaction: t }
          );
          continue;
        }

        // ---------- CREATE NEW ----------
        const required = ["studentFirstName", "studentLastName", "dateOfBirth", "age", "gender"];
        const missing = required.filter(f => !s[f] || String(s[f]).trim() === "");

        if (missing.length > 0) {
          await t.rollback();
          return { status: false, message: `Missing required fields: ${missing.join(", ")}` };
        }

        await OneToOneStudent.create(
          {
            oneToOneBookingId: booking.id,
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInfo: s.medicalInfo ?? "",
          },
          { transaction: t }
        );
      }
    }

    // ======================================================
    // 👨‍👩‍👧 PARENTS (STRICT VALIDATION + ADMIN SYNC)
    // ======================================================
    if (Array.isArray(updateData?.parentDetails)) {
      for (let index = 0; index < updateData.parentDetails.length; index++) {
        const p = updateData.parentDetails[index];
        const isFirstParent =
          index === 0 && booking.parentAdminId && !adminSynced;

        // 🔒 PRE-CHECK Admin email uniqueness (FIRST parent only)
        if (isFirstParent && p.parentEmail) {
          const admin = await Admin.findByPk(booking.parentAdminId, {
            transaction: t,
            paranoid: false,
          });

          if (admin && p.parentEmail !== admin.email) {
            const emailExists = await Admin.findOne({
              where: {
                email: p.parentEmail,
                id: { [Op.ne]: admin.id },
              },
              transaction: t,
              paranoid: false,
            });

            if (emailExists) {
              await t.rollback();
              return {
                status: false,
                message: "This email is already in use",
              };
            }
          }
        }

        // ---------- UPDATE ----------
        if (p.id) {
          const existingParent = await OneToOneParent.findOne({
            where: { id: p.id },
            transaction: t,
          });

          if (existingParent) {
            await existingParent.update(
              {
                parentFirstName: p.parentFirstName ?? existingParent.parentFirstName,
                parentLastName: p.parentLastName ?? existingParent.parentLastName,
                parentEmail: p.parentEmail ?? existingParent.parentEmail,
                phoneNumber: p.phoneNumber ?? existingParent.phoneNumber,
                relationChild: p.relationChild ?? existingParent.relationChild,
                howDidHear: p.howDidHear ?? existingParent.howDidHear,
              },
              { transaction: t }
            );
          }
        } else {
          // ---------- CREATE ----------
          const requiredParentFields = [
            "parentFirstName",
            "parentLastName",
            "parentEmail",
            "phoneNumber",
            "relationChild",
            "studentId",
          ];

          const missing = requiredParentFields.filter(
            (f) => !p[f] || String(p[f]).trim() === ""
          );

          if (missing.length > 0) {
            await t.rollback();
            return {
              status: false,
              message: `Missing required fields: ${missing.join(", ")}`,
            };
          }

          await OneToOneParent.create(
            {
              studentId: p.studentId,
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              phoneNumber: p.phoneNumber,
              relationChild: p.relationChild,
              howDidHear: p.howDidHear ?? "",
            },
            { transaction: t }
          );
        }

        // 🔹 Sync FIRST parent → Admin (ONCE)
        if (isFirstParent) {
          const admin = await Admin.findByPk(booking.parentAdminId, {
            transaction: t,
            paranoid: false,
          });

          if (admin) {
            if (p.parentFirstName !== undefined)
              admin.firstName = p.parentFirstName;

            if (p.parentLastName !== undefined)
              admin.lastName = p.parentLastName;

            if (p.parentEmail !== undefined)
              admin.email = p.parentEmail;

            if (p.phoneNumber !== undefined)
              admin.phoneNumber = p.phoneNumber;

            await admin.save({ transaction: t });
            adminSynced = true;
          }
        }
      }
    }

    // ======================================================
    // 🚨 EMERGENCY DETAILS (STRICT VALIDATION)
    // ======================================================
    if (updateData?.emergencyDetails) {
      const e = updateData.emergencyDetails;

      // ---------- UPDATE ----------
      if (e.id) {
        const existingEmergency = await OneToOneEmergency.findOne({
          where: { id: e.id },
          transaction: t,
        });

        if (existingEmergency) {
          await existingEmergency.update(
            {
              emergencyFirstName: e.emergencyFirstName ?? existingEmergency.emergencyFirstName,
              emergencyLastName: e.emergencyLastName ?? existingEmergency.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber ?? existingEmergency.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation ?? existingEmergency.emergencyRelation,
            },
            { transaction: t }
          );
        }
        // skip creation
      } else {
        // ---------- CREATE NEW ----------
        const requiredEmergency = [
          "emergencyFirstName",
          "emergencyLastName",
          "emergencyPhoneNumber",
          "emergencyRelationChild",
          "studentId"
        ];

        const missing = requiredEmergency.filter(f => !e[f] || String(e[f]).trim() === "");

        if (missing.length > 0) {
          await t.rollback();
          return { status: false, message: `Missing required fields: ${missing.join(", ")}` };
        }

        await OneToOneEmergency.create(
          {
            studentId: e.studentId,
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelationChild: e.emergencyRelationChild,
          },
          { transaction: t }
        );
      }
    }

    await t.commit();
    return { status: true, message: "Lead updated successfully." };

  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

// exports.updateOnetoOneLeadById = async (id, superAdminId, adminId, updateData) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🔹 Fetching lead with ID:", id);

//     const lead = await oneToOneLeads.findOne({
//       where: {
//         id,
//         [Op.or]: [
//           { createdBy: adminId },
//           { createdBy: superAdminId }
//         ]
//       },
//       include: [
//         {
//           model: OneToOneBooking,
//           as: "booking",
//           include: [
//             {
//               model: OneToOneStudent,
//               as: "students",
//               include: [
//                 { model: OneToOneParent, as: "parentDetails" },
//                 { model: OneToOneEmergency, as: "emergencyDetails" },
//               ],
//             },
//           ],
//         },
//       ],
//       transaction: t,
//     });

//     if (!lead) {
//       console.log("⚠️ Lead not found or unauthorized");
//       await t.rollback();
//       return { status: false, message: "Lead not found or unauthorized." };
//     }

//     const booking = lead.booking;
//     if (!booking) {
//       console.log("⚠️ Booking not found for this lead");
//       await t.rollback();
//       return { status: false, message: "Booking not found for this lead." };
//     }

//     // ======================================================
//     // 🧩 STUDENTS
//     // ======================================================
//     if (updateData?.student && Array.isArray(updateData.student) && updateData.student.length) {
//       console.log("🔹 Updating/creating students:", updateData.student);
//       for (const studentData of updateData.student) {
//         if (studentData.id) {
//           const existingStudent = await OneToOneStudent.findOne({
//             where: { id: studentData.id, oneToOneBookingId: booking.id },
//             transaction: t,
//           });
//           if (existingStudent) {
//             console.log(`🔄 Updating existing student id=${studentData.id}`);
//             await existingStudent.update(
//               {
//                 studentFirstName: studentData.studentFirstName ?? existingStudent.studentFirstName,
//                 studentLastName: studentData.studentLastName ?? existingStudent.studentLastName,
//                 dateOfBirth: studentData.dateOfBirth ?? existingStudent.dateOfBirth,
//                 age: studentData.age ?? existingStudent.age,
//                 gender: studentData.gender ?? existingStudent.gender,
//                 medicalInfo: studentData.medicalInfo ?? existingStudent.medicalInfo,
//               },
//               { transaction: t }
//             );
//             console.log(`✅ Updated student id=${studentData.id}`);
//           } else {
//             console.log(`⚠️ Student id=${studentData.id} not found, skipping`);
//           }
//         } else {
//           console.log("➕ Creating new student:", studentData);
//           await OneToOneStudent.create(
//             {
//               oneToOneBookingId: booking.id,
//               studentFirstName: studentData.studentFirstName,
//               studentLastName: studentData.studentLastName,
//               dateOfBirth: studentData.dateOfBirth,
//               age: studentData.age,
//               gender: studentData.gender,
//               medicalInfo: studentData.medicalInfo,
//             },
//             { transaction: t }
//           );
//           console.log(`✅ Created new student: ${studentData.studentFirstName} ${studentData.studentLastName}`);
//         }
//       }
//     }

//     // ======================================================
//     // 👨‍👩‍👧 PARENTS
//     // ======================================================
//     if (updateData?.parentDetails && Array.isArray(updateData.parentDetails)) {
//       console.log("🔹 Updating/creating parent details:", updateData.parentDetails);

//       for (const parentData of updateData.parentDetails) {
//         if (parentData.id) {
//           console.log(`🔄 Attempting to update existing parent id=${parentData.id}`);
//           const existingParent = await OneToOneParent.findOne({
//             where: { id: parentData.id },
//             transaction: t,
//           });

//           if (existingParent) {
//             console.log(`✅ Found parent id=${parentData.id}, updating fields`);
//             await existingParent.update(
//               {
//                 parentFirstName: parentData.parentFirstName ?? existingParent.parentFirstName,
//                 parentLastName: parentData.parentLastName ?? existingParent.parentLastName,
//                 parentEmail: parentData.parentEmail ?? existingParent.parentEmail,
//                 phoneNumber: parentData.phoneNumber ?? existingParent.phoneNumber,
//                 relationChild: parentData.relationChild ?? existingParent.relationChild,
//                 howDidHear: parentData.howDidHear ?? existingParent.howDidHear,
//               },
//               { transaction: t }
//             );
//             console.log('Parent updated:', existingParent.toJSON());
//           } else {
//             console.log(`⚠️ Parent id=${parentData.id} not found, cannot update`);
//           }
//         } else if (parentData.studentId) {
//           console.log(`➕ Creating new parent for studentId=${parentData.studentId}`);
//           const newParent = await OneToOneParent.create(
//             {
//               studentId: parentData.studentId,
//               parentFirstName: parentData.parentFirstName,
//               parentLastName: parentData.parentLastName,
//               parentEmail: parentData.parentEmail,
//               phoneNumber: parentData.phoneNumber,
//               relationChild: parentData.relationChild,
//               howDidHear: parentData.howDidHear,
//             },
//             { transaction: t }
//           );
//           console.log('Parent created:', newParent.toJSON());
//         } else {
//           console.log("⚠️ Skipping parent entry (no id or studentId provided):", parentData);
//         }
//       }
//     }

//     // ======================================================
//     // 🚨 EMERGENCY DETAILS
//     // ======================================================
//     if (updateData?.emergencyDetails && updateData.emergencyDetails.id) {
//       console.log(`🔄 Updating emergency details id=${updateData.emergencyDetails.id}`);
//       const e = updateData.emergencyDetails;
//       const existingEmergency = await OneToOneEmergency.findOne({
//         where: { id: e.id },
//         transaction: t,
//       });
//       if (existingEmergency) {
//         await existingEmergency.update(
//           {
//             emergencyFirstName: e.emergencyFirstName ?? existingEmergency.emergencyFirstName,
//             emergencyLastName: e.emergencyLastName ?? existingEmergency.emergencyLastName,
//             phoneNumber: e.phoneNumber ?? existingEmergency.phoneNumber,
//             relationChild: e.relationChild ?? existingEmergency.relationChild,
//           },
//           { transaction: t }
//         );
//         console.log(`✅ Updated emergency details id=${e.id}`);
//       } else {
//         console.log(`⚠️ Emergency details id=${e.id} not found, skipping`);
//       }
//     }

//     // Commit transaction
//     await t.commit();
//     console.log("✅ Transaction committed successfully");

//     return {
//       status: true,
//       message: "Lead updated successfully.",
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ Error updating one-to-one lead:", error);
//     return { status: false, message: error.message };
//   }
// };

// Get All One-to-One Analytics

const getDateRangeByFilter = (filterType) => {
  if (!filterType || filterType === "thisYear") {
    return {
      current: {
        startDate: moment().startOf("year").toDate(),
        endDate: moment().endOf("year").toDate(),
      },
      previous: {
        startDate: moment().subtract(1,
          "year").startOf("year").toDate(),
        endDate: moment().subtract(1,
          "year").endOf("year").toDate(),
      },
    };
  }
  // optional future support
  if (
    filterType === "thisMonth" ||
    filterType === "lastMonth" ||
    filterType === "last3Months" ||
    filterType === "last6Months"
  ) {
    let currentStart;
    let currentEnd;
    let previousStart;
    let previousEnd;

    switch (filterType) {
      case "thisMonth":
        currentStart = moment().startOf("month");
        currentEnd = moment().endOf("month");

        previousStart = moment().subtract(1, "month").startOf("month");
        previousEnd = moment().subtract(1, "month").endOf("month");
        break;

      case "lastMonth":
        currentStart = moment().subtract(1, "month").startOf("month");
        currentEnd = moment().subtract(1, "month").endOf("month");

        previousStart = moment().subtract(2, "month").startOf("month");
        previousEnd = moment().subtract(2, "month").endOf("month");
        break;

      case "last3Months":
        currentStart = moment().subtract(3, "months").startOf("month");
        currentEnd = moment().endOf("month");

        previousStart = moment().subtract(6, "months").startOf("month");
        previousEnd = moment().subtract(3, "months").endOf("month");
        break;

      case "last6Months":
        currentStart = moment().subtract(6, "months").startOf("month");
        currentEnd = moment().endOf("month");

        previousStart = moment().subtract(12, "months").startOf("month");
        previousEnd = moment().subtract(6, "months").endOf("month");
        break;
    }

    return {
      current: {
        startDate: currentStart.toDate(),
        endDate: currentEnd.toDate(),
      },
      previous: {
        startDate: previousStart.toDate(),
        endDate: previousEnd.toDate(),
      },
    };
  }

  throw new Error("Invalid filterType");
};

exports.getAllOneToOneAnalytics = async (superAdminId, adminId, filterType = "thisYear") => {
  try {

    const currentYear = moment().year();
    const lastYear = currentYear - 1;

    const defaultMonthlyStudents = () =>
      Array.from({
        length: 12
      }, (_, i) => ({
        month: moment().month(i).format("MMMM"),
        students: 0,
        bookings: 0
      }));

    const defaultCountBreakdown = (names = []) =>
      names.map(name => ({
        name,
        count: 0,
        percentage: 0
      }));

    const defaultRevenueByPackage = (names = []) =>
      names.map(name => ({
        name,
        currentRevenue: 0,
        lastRevenue: 0,
        revenueGrowth: 0
      }));

    const whereLead = {}; // ✅ initialize first

    // ✅ Super Admin logic
    if (superAdminId && superAdminId === adminId) {
      // 🟣 SUPER ADMIN
      const managedAdmins = await Admin.findAll({
        where: {
          superAdminId
        },
        attributes: [
          "id"
        ],
      });

      const adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);

      whereLead[Op.or
      ] = [
          {
            createdBy: {
              [Op.in
              ]: adminIds
            }
          },
          {
            createdBy: null
          }
        ];
    }
    else if (superAdminId && adminId) {
      // 🟢 ADMIN
      whereLead[Op.or
      ] = [
          {
            createdBy: {
              [Op.in
              ]: [adminId, superAdminId
                ]
            }
          },
          {
            createdBy: null
          }
        ];
    }
    else {
      // 🔵 FALLBACK
      whereLead[Op.or
      ] = [
          {
            createdBy: adminId
          },
          {
            createdBy: null
          }
        ];
    }
    // 🗓️ Define date ranges dynamically based on filterType

    const {
      current: { startDate, endDate
      },
      previous: { startDate: prevStart, endDate: prevEnd
      },
    } = getDateRangeByFilter(filterType);

    const startOfLastMonth = moment(startDate).subtract(1,
      "month").toDate();
    const endOfLastMonth = moment(endDate).subtract(1,
      "month").toDate();

    const whereLastMonth = {
      ...whereLead,
      createdAt: {
        [Op.between
        ]: [startOfLastMonth, endOfLastMonth
          ]
      },
    };
    // ✅ Total Leads (scoped to the lead owners determined by whereLead)
    const totalLeadsThisYear = await oneToOneLeads.count({
      where: {
        ...whereLead,
        createdAt: {
          [Op.between
          ]: [startDate, endDate
            ]
        },
      },
    });

    const totalLeadsLastYear = await oneToOneLeads.count({
      where: {
        ...whereLead,
        createdAt: {
          [Op.between
          ]: [prevStart, prevEnd
            ]
        },
      },
    });

    // ✅ Number of Sales (active bookings only)
    const salesThisYear = await OneToOneBooking.count({
      where: {
        status: "active",
        createdAt: {
          [Op.between
          ]: [startDate, endDate
            ]
        },
      },
      include: [
        {
          model: oneToOneLeads,
          as: "lead",
          where: whereLead,
          required: true,
        }
      ],
    });

    const salesLastYear = await OneToOneBooking.count({
      where: {
        status: "active",
        createdAt: {
          [Op.between
          ]: [prevStart, prevEnd
            ]
        },
      },
      include: [
        {
          model: oneToOneLeads,
          as: "lead",
          where: whereLead,
          required: true,
        }
      ],
    });

    // ✅ Conversion Rate
    const conversionThisYear =
      totalLeadsThisYear > 0
        ? ((salesThisYear / totalLeadsThisYear) * 100).toFixed(2)
        : "0.00";

    const conversionLastYear =
      totalLeadsLastYear > 0
        ? ((salesLastYear / totalLeadsLastYear) * 100).toFixed(2)
        : "0.00";

    // ✅ Revenue Generated (based on lead.createdBy)
    // ✅ THIS YEAR revenue
    const paymentsThisYear = await OneToOnePayment.findAll({
      attributes: [[fn("SUM", col("OneToOnePayment.amount")), "total"]],
      include: [{
        model: OneToOneBooking,
        as: "booking",
        attributes: [],
        include: [{
          model: oneToOneLeads,
          as: "lead",
          attributes: [],
          where: whereLead,
          required: true,
        }],
        required: true,
      }],
      where: {
        createdAt: { [Op.between]: [startDate, endDate] },
      },
      raw: true,
    });

    // ✅ LAST YEAR revenue
    const paymentsLastYear = await OneToOnePayment.findAll({
      attributes: [[fn("SUM", col("OneToOnePayment.amount")), "total"]],
      include: [{
        model: OneToOneBooking,
        as: "booking",
        attributes: [],
        include: [{
          model: oneToOneLeads,
          as: "lead",
          attributes: [],
          where: whereLead,
          required: true,
        }],
        required: true,
      }],
      where: {
        createdAt: { [Op.between]: [prevStart, prevEnd] },
      },
      raw: true,
    });

    const revenueThisYear = Number(paymentsThisYear[0]?.total || 0);
    const revenueLastYear = Number(paymentsLastYear[0]?.total || 0);

    // ✅ Source Breakdown (Marketing)
    const sourceBreakdown = await oneToOneLeads.findAll({
      where: {
        ...whereLead,
        createdAt: {
          [Op.between
          ]: [startDate, endDate
            ]
        }
      }
    });

    // ✅ Top Agents
    const topAgents = await oneToOneLeads.findAll({
      attributes: ["createdBy", [fn("COUNT", col("createdBy")), "leadCount"]],
      where: {
        ...whereLead,
        createdBy: { [Op.ne]: null },
        createdAt: { [Op.between]: [startDate, endDate] },
      },
      include: [
        {
          model: Admin,
          as: "creator",
          attributes: ["id", "firstName", "lastName", "profile"],
          required: true,
        },
      ],
      group: ["createdBy", "creator.id"],
      order: [[literal("leadCount"), "DESC"]],
      limit: 5,
    });

    const safeTopAgents = topAgents.filter(
      a => a.createdBy !== null && a.leadCount > 0
    );

    // 🧠 Generate all 12 months (Jan → Dec)
    const allMonths = Array.from({
      length: 12
    }, (_, i) => ({
      month: moment().month(i).format("MMMM"),
      students: 0,
      bookings: 0,
    }));
    // ✅ One-to-One Students (monthly trend — show all months)
    const monthlyStudentsRaw = await OneToOneBooking.findAll({
      attributes: [
        [
          fn("DATE_FORMAT", col("OneToOneBooking.createdAt"),
            "%M"),
          "month",
        ], // e.g. "October"
        [fn("COUNT", col("OneToOneBooking.id")),
          "bookings"
        ], // total bookings
        [fn("COUNT", fn("DISTINCT", col("students.id"))),
          "students"
        ], // unique students linked to those bookings
      ],
      include: [
        {
          model: OneToOneStudent,
          as: "students",
          attributes: [],
          required: true,
        },
        {
          model: oneToOneLeads,
          as: "lead", // ✅ ensure association name matches your model
          attributes: [],
          where: whereLead, // ✅ filter by lead.createdBy
          required: true,
        },
      ],
      where: {
        status: {
          [Op.in
          ]: [
              "pending",
              "active"
            ]
        },
        createdAt: {
          [Op.between
          ]: [startDate, endDate
            ]
        },
      },
      group: [fn("MONTH", col("OneToOneBooking.createdAt"))
      ],
      order: [
        [fn("MONTH", col("OneToOneBooking.createdAt")),
          "ASC"
        ]
      ],
      raw: true,
    });

    const lastYearMonthlyStudentsRaw = await OneToOneBooking.findAll({
      attributes: [
        [fn("DATE_FORMAT", col("OneToOneBooking.createdAt"),
          "%M"),
          "month"
        ],
        [fn("COUNT", col("OneToOneBooking.id")),
          "bookings"
        ],
        [fn("COUNT", fn("DISTINCT", col("students.id"))),
          "students"
        ],
      ],
      include: [
        {
          model: OneToOneStudent,
          as: "students",
          attributes: [],
          required: true,
        },
        {
          model: oneToOneLeads,
          as: "lead",
          attributes: [],
          where: whereLead,
          required: true,
        },
      ],
      where: {
        status: {
          [Op.in
          ]: [
              "pending",
              "active"
            ]
        },
        createdAt: {
          [Op.between
          ]: [
              moment().subtract(1,
                "year").startOf("year").toDate(),
              moment().subtract(1,
                "year").endOf("year").toDate(),
            ],
        },
      },
      group: [fn("MONTH", col("OneToOneBooking.createdAt"))
      ],
      order: [
        [fn("MONTH", col("OneToOneBooking.createdAt")),
          "ASC"
        ]
      ],
      raw: true,
    });
    const lastYearMonthlyStudents = allMonths.map((m) => {
      const found = lastYearMonthlyStudentsRaw.find(
        (r) => r.month === m.month
      );

      return {
        month: m.month,
        students: found ? parseInt(found.students,
          10) : 0,
        bookings: found ? parseInt(found.bookings,
          10) : 0
      };
    });
    const lastYearMarketChannelRaw = await oneToOneLeads.findAll({
      attributes: [
        "source",
        [fn("COUNT", col("source")),
          "count"
        ]
      ],
      where: {
        ...whereLead,
        source: {
          [Op.ne
          ]: null
        },
        createdAt: {
          [Op.between
          ]: [
              moment().subtract(1,
                "year").startOf("year").toDate(),
              moment().subtract(1,
                "year").endOf("year").toDate()
            ]
        }
      },
      group: [
        "source"
      ],
      raw: true
    });

    const lastYearTotalSources = lastYearMarketChannelRaw.reduce(
      (sum, s) => sum + parseInt(s.count,
        10),
      0
    );
    const lastYearSourceBreakdown = lastYearMarketChannelRaw.map(s => ({
      name: s.source,
      count: parseInt(s.count,
        10),
      percentage: 0
    }))

    const lastYearMarketChannelPerformance = lastYearMarketChannelRaw.map((s) => {
      const count = parseInt(s.count,
        10);
      const percentage =
        lastYearTotalSources > 0
          ? ((count / lastYearTotalSources) * 100).toFixed(2)
          : 0;

      return {
        name: s.source,
        count,
        percentage: parseFloat(percentage)
      };
    });

    // 🧩 Merge DB results into allMonths
    const monthlyStudents = allMonths.map((m) => {
      const found = monthlyStudentsRaw.find((r) => r.month === m.month);
      return {
        month: m.month,
        students: found ? parseInt(found.students,
          10) : 0,
        bookings: found ? parseInt(found.bookings,
          10) : 0,
      };
    });

    // ✅ Package Breakdown (filtered by lead.createdBy)
    const packageBreakdown = await oneToOneLeads.findAll({
      attributes: [
        [
          "packageInterest",
          "packageName"
        ], // e.g., Gold / Silver / 
        [fn("COUNT", col("packageInterest")),
          "count"
        ],
      ],
      where: {
        ...whereLead, // ✅ add lead.createdBy filter here
        packageInterest: {
          [Op.in
          ]: [
              "Gold",
              "Silver"
            ]
        },
        createdAt: {
          [Op.between
          ]: [startDate, endDate
            ]
        },
      },
      group: [
        "packageInterest"
      ],
      raw: true,
    });

    // 🧮 Total Count (for percentages)
    const totalPackages = packageBreakdown.reduce(
      (sum, pkg) => sum + parseInt(pkg.count,
        10),
      0
    );

    // 🧠 Format data for frontend donut chart
    const formattedPackages = packageBreakdown.map((pkg) => {
      const count = parseInt(pkg.count,
        10);
      const percentage =
        totalPackages > 0 ? ((count / totalPackages) * 100).toFixed(2) : 0;
      return {
        name: pkg.packageName, // Gold / Silver / Platinum
        value: parseFloat((count / 1000).toFixed(3)), // e.g. 1.235 (mock scaling)
        percentage: parseFloat(percentage), // e.g. 25.00
      };
    });

    // ✅ Renewal Breakdown (Gold, Silver, Platinum)
    const renewalBreakdownRaw = await OneToOneBooking.findAll({
      where: {
        createdAt: {
          [Op.between
          ]: [startDate, endDate
            ]
        }
      },
      attributes: [
        [col("lead.packageInterest"),
          "packageName"
        ], // join with lead’s package
        [fn("COUNT", col("OneToOneBooking.id")),
          "count"
        ],
      ],
      include: [
        {
          model: oneToOneLeads,
          as: "lead", // 👈 must match association alias in OneToOneBooking model
          attributes: [],
          where: {
            packageInterest: {
              [Op.in
              ]: [
                  "Gold",
                  "Silver"
                ]
            },
          },
          required: true,
        },
      ],
      group: [
        "lead.packageInterest"
      ],
      raw: true,
    });

    // 🧮 Calculate total renewals
    const totalRenewals = renewalBreakdownRaw.reduce(
      (sum, r) => sum + parseInt(r.count,
        10),
      0
    );

    // 🧠 Format for frontend (progress bar chart)
    const renewalBreakdown = [
      "Gold",
      "Silver"
    ].map((pkgName) => {
      const found = renewalBreakdownRaw.find((r) => r.packageName === pkgName);
      const count = found ? parseInt(found.count,
        10) : 0;
      const percentage =
        totalRenewals > 0 ? ((count / totalRenewals) * 100).toFixed(2) : 0;

      return {
        name: pkgName,
        count,
        percentage: parseFloat(percentage),
      };
    });

    const revenueByPackageThisYear = await OneToOnePayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
      ],
      include: [{
        model: OneToOneBooking,
        as: "booking",
        attributes: [],
        include: [{
          model: oneToOneLeads,
          as: "lead",
          attributes: [],
          where: {
            ...whereLead,
            packageInterest: { [Op.in]: ["Gold", "Silver"] },
          },
          required: true,
        }],
        required: true,
      }],
      where: {
        createdAt: { [Op.between]: [startDate, endDate] },
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    const revenueByPackageLastYear = await OneToOnePayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
      ],
      include: [{
        model: OneToOneBooking,
        as: "booking",
        attributes: [],
        include: [{
          model: oneToOneLeads,
          as: "lead",
          attributes: [],
          where: {
            ...whereLead,
            packageInterest: { [Op.in]: ["Gold", "Silver"] },
          },
          required: true,
        }],
        required: true,
      }],
      where: {
        createdAt: { [Op.between]: [prevStart, prevEnd] },
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    // 🧮 Combine and calculate growth %
    const revenueByPackage = ["Gold", "Silver"].map(pkg => {
      const current = revenueByPackageThisYear.find(r => r.packageName === pkg);
      const last = revenueByPackageLastYear.find(r => r.packageName === pkg);

      const currentRevenue = Number(current?.totalRevenue || 0);
      const lastRevenue = Number(last?.totalRevenue || 0);

      const revenueGrowth =
        lastRevenue > 0
          ? Number((((currentRevenue - lastRevenue) / lastRevenue) * 100).toFixed(2))
          : currentRevenue > 0 ? 100 : 0;

      return {
        name: pkg,
        thisYear: currentRevenue,
        lastYear: lastRevenue,
        revenueGrowth,
      };
    });

    // ✅ Marketing Channel Performance
    const marketChannelRaw = await oneToOneLeads.findAll({
      attributes: ["source", [fn("COUNT", col("source")), "count"]],
      where: {
        ...whereLead,
        source: { [Op.ne]: null },
        createdAt: { [Op.between]: [startDate, endDate] },
      },
      group: ["source"],
      raw: true,
    });

    const totalSources = marketChannelRaw.r

    const marketChannelPerformance = marketChannelRaw.map((s) => {
      const count = parseInt(s.count, 10);
      const percentage =
        totalSources > 0 ? ((count / totalSources) * 100).toFixed(2) : 0;

      return {
        name: s.source, // e.g. "Facebook"
        count, // e.g. 23456
        percentage: parseFloat(percentage), // e.g. 50.00
      };
    });

    // 🎉 Calculate Party Booking performance (by age and gender)
    const partyBookingRaw = await OneToOneStudent.findAll({
      attributes: [
        "age",
        "gender",
        [fn("COUNT", col("OneToOneStudent.id")),
          "count"
        ],
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
                ...whereLead
              }, // ✅ filter by lead.createdBy (scope)
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: {
          [Op.between
          ]: [startDate, endDate
            ]
        },
      },
      group: [
        "age",
        "gender"
      ],
      order: [
        [literal("count"),
          "DESC"
        ]
      ],
      raw: true,
    });

    // 🧠 Format data for frontend (progress bar UI)
    const totalBookings = partyBookingRaw.reduce(
      (sum, s) => sum + parseInt(s.count,
        10),
      0
    );

    // 2️⃣ Group by Age
    const byAgeMap = {};
    partyBookingRaw.forEach((s) => {
      const age = s.age || "Unknown";
      const count = parseInt(s.count,
        10);
      byAgeMap[age
      ] = (byAgeMap[age
      ] || 0) + count;
    });

    const byAge = Object.entries(byAgeMap).map(([age, count
    ]) => ({
      name: age.toString(),
      count,
      percentage:
        totalBookings > 0
          ? parseFloat(((count / totalBookings) * 100).toFixed(2))
          : 0,
    }));

    // 3️⃣ Group by Gender
    const byGenderMap = {};
    partyBookingRaw.forEach((s) => {
      const gender = s.gender || "Unknown";
      const count = parseInt(s.count,
        10);
      byGenderMap[gender
      ] = (byGenderMap[gender
      ] || 0) + count;
    });

    const byGender = Object.entries(byGenderMap).map(([gender, count
    ]) => ({
      name: gender,
      count,
      percentage:
        totalBookings > 0
          ? parseFloat(((count / totalBookings) * 100).toFixed(2))
          : 0,
    }));

    // 4️⃣ By Total
    const byTotal = [
      {
        name: "Total",
        count: totalBookings,
        percentage: 100.0,
      },
    ];

    // ✅ Final structured output
    const partyBooking = [
      {
        byAge,
        byGender,
        byTotal,
      },
    ];

    // Example mapping rule
    // ==========================================
    // PACKAGE BACKGROUND (Growth + Revenue)
    // ==========================================
    // 1️⃣ Growth = lead count (packageBreakdown)
    const growth = [
      "Gold",
      "Silver"
    ].map(pkgName => {
      const found = packageBreakdown.find(p => p.packageName === pkgName);
      const count = found ? parseInt(found.count) : 0;
      const percentage =
        totalPackages > 0 ? parseFloat(((count / totalPackages) * 100).toFixed(2)) : 0;

      return {
        name: pkgName,
        count,
        percentage
      };
    }).filter(item => item.count > 0); // remove empty ones

    // 2️⃣ Revenue = revenueByPackage (from payment totals)
    const totalRevenue = revenueByPackage.reduce(
      (sum, p) => sum + p.currentRevenue,
      0
    );

    const revenue = [
      "Gold",
      "Silver"
    ].map(pkgName => {
      const found = revenueByPackage.find(
        r => r.name?.toLowerCase() === pkgName.toLowerCase()
      );

      const count = found?.currentRevenue ?? 0;
      const percentage =
        totalRevenue > 0
          ? Number(((count / totalRevenue) * 100).toFixed(2))
          : 0;

      return {
        name: pkgName, count, percentage
      };
    });

    // 3️⃣ Final output
    const packageBackground = [
      {
        growth
      },
      {
        revenue
      }
    ];
    // ===============================
    // PACKAGE REVENUE (SUMMARY)
    // ===============================

    const revenueGoldThisYear =
      revenueByPackage.find(p => p.name === "Gold")?.thisYear || 0;

    const revenueGoldLastYear =
      revenueByPackage.find(p => p.name === "Gold")?.lastYear || 0;

    const revenueSilverThisYear =
      revenueByPackage.find(p => p.name === "Silver")?.thisYear || 0;

    const revenueSilverLastYear =
      revenueByPackage.find(p => p.name === "Silver")?.lastYear || 0;

    // ✅ Final Structured Response (matches Figma)
    return {
      status: true,
      message: "Fetched One-to-One analytics successfully.",
      summary: {
        totalLeads: {
          thisYear: totalLeadsThisYear,
          lastYear: totalLeadsLastYear,
        },
        numberOfSales: {
          thisYear: salesThisYear,
          lastYear: salesLastYear,
        },
        conversionRate: {
          thisYear: `${conversionThisYear
            }%`,
          lastYear: `${conversionLastYear
            }%`,
        },
        revenueGenerated: {
          thisYear: revenueThisYear,
          lastYear: revenueLastYear,
        },
        revenueGoldPackage: {
          thisYear: revenueGoldThisYear,
          lastYear: revenueGoldLastYear,
        },
        revenueSilverPackage: {
          thisYear: revenueSilverThisYear,
          lastYear: revenueSilverLastYear,
        },
      },

      charts: {
        currentYear: {
          year: currentYear,
          monthlyStudents: monthlyStudents || [],
          marketChannelPerformance: marketChannelPerformance || [],
          sourceBreakdown: sourceBreakdown || [],
          topAgents: topAgents || [],
          partyBooking: partyBooking || [],
          packageBackground: packageBackground || [],
          renewalBreakdown: renewalBreakdown || [],
          packageBreakdown: formattedPackages || [],
          revenueByPackage: revenueByPackage || []
        },
        lastYear: {
          year: lastYear,
          // monthlyStudents: defaultMonthlyStudents(),
          monthlyStudents: useOrDefault(
            lastYearMonthlyStudents,
            defaultMonthlyStudents()
          ),

          marketChannelPerformance: useOrDefault(
            lastYearMarketChannelPerformance,
            defaultCountBreakdown([
              "Flyer",
              "Online",
              "Referral"
            ])
          ),
          sourceBreakdown: useOrDefault(
            lastYearSourceBreakdown,
            defaultCountBreakdown([
              "Flyer",
              "Online",
              "Referral"
            ])
          ),
          topAgents: safeTopAgents.length ? safeTopAgents : [],

          partyBooking: [
            {
              byAge: [],
              byGender: defaultCountBreakdown([
                "male",
                "female",
                "other"
              ]),
              byTotal: [
                {
                  name: "Total",
                  count: 0,
                  percentage: 100
                }
              ]
            }
          ],

          packageBackground: [
            {
              growth: defaultCountBreakdown([
                "Gold",
                "Silver"
              ])
            },
            {
              revenue: defaultCountBreakdown([
                "Gold",
                "Silver"
              ])
            }
          ],

          renewalBreakdown: defaultCountBreakdown([
            "Gold",
            "Silver"
          ]),

          packageBreakdown: defaultCountBreakdown([
            "Gold",
            "Silver"
          ]),

          revenueByPackage: defaultRevenueByPackage([
            "Gold",
            "Silver"
          ])
        }
      }
    };
  } catch (error) {
    console.error("❌ Error fetching One-to-One analytics:", error);
    return {
      status: false, message: error.message
    };
  }
};

exports.sendEmailToFirstParentWithBooking = async (leadIds = []) => {
  try {
    console.log("📥 Received leadIds:", leadIds);

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      console.log("❌ No leadIds provided");
      return { status: false, message: "Please provide at least one leadId." };
    }

    // Fetch leads with bookings
    const leadsWithBooking = await oneToOneLeads.findAll({
      where: { id: leadIds },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          include: [
            {
              model: OneToOneStudent,
              as: "students",
              include: [{ model: OneToOneParent, as: "parentDetails" }],
            },
            { model: OneToOnePayment, as: "payment" },
          ],
        },
      ],
    });

    console.log("📦 Leads with booking fetched:", leadsWithBooking.length);

    if (!leadsWithBooking.length) {
      return { status: false, message: "No matching leads found with active bookings." };
    }

    // Email configuration
    const emailConfigResult = await getEmailConfig("admin", "one-to-one-booking-sendEmail");
    if (!emailConfigResult.status) {
      console.log("❌ Email configuration not found");
      return { status: false, message: "Email configuration not found." };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;
    console.log("✅ Email configuration fetched");

    let totalSent = 0;
    const sentTo = [];
    const skipped = [];
    const errors = [];

    for (const lead of leadsWithBooking) {
      console.log(`\n🔹 Processing leadId=${lead.id}`);
      try {
        const booking = lead.booking;

        if (!booking || !booking.students || booking.students.length === 0) {
          skipped.push({ leadId: lead.id, reason: "No students found in booking" });
          console.log("⏭ Skipped: No students found in booking");
          continue;
        }

        // Get the first student and parent
        const firstStudent = booking.students[0];
        const firstParent = firstStudent.parentDetails?.[0] || firstStudent.parent || null;
        const parentEmail = firstParent?.parentEmail || firstParent?.email;

        if (!firstParent || !parentEmail) {
          skipped.push({ leadId: lead.id, reason: "No valid parent email" });
          console.log("⏭ Skipped: No valid parent email found");
          continue;
        }

        console.log("👨‍👩‍👧 Sending to parent:", parentEmail);

        const bookingDate = booking.date || "TBA";
        const bookingTime = booking.time || "TBA";
        const location = booking.location || "Not specified";
        const address = booking.address || "Not specified";
        const packageName = lead.packageInterest || "N/A";
        const status = lead.status || "N/A";
        const paymentStatus = booking.payment?.paymentStatus || "unknown";
        const paymentAmount = booking.payment?.amount || "0.00";

        const studentNames = booking.students
          .map((s) => `${s.studentFirstName} ${s.studentLastName}`)
          .join(", ");

        const finalHtml = htmlTemplate
          .replace(/{{parentName}}/g, `${firstParent.parentFirstName || ""} ${firstParent.parentLastName || ""}`.trim())
          .replace(/{{studentNames}}/g, studentNames)
          .replace(/{{packageName}}/g, packageName)
          .replace(/{{location}}/g, location)
          .replace(/{{address}}/g, address)
          .replace(/{{date}}/g, bookingDate)
          .replace(/{{status}}/g, status)
          .replace(/{{time}}/g, bookingTime)
          .replace(/{{paymentStatus}}/g, paymentStatus)
          .replace(/{{amount}}/g, paymentAmount)
          .replace(/{{relationChild}}/g, firstParent.relationChild || "Parent")
          .replace(/{{appName}}/g, "Synco")
          .replace(/{{year}}/g, new Date().getFullYear());

        const recipient = [{ name: `${firstParent.parentFirstName || ""} ${firstParent.parentLastName || ""}`.trim(), email: parentEmail }];

        const sendResult = await sendEmail(emailConfig, { recipient, subject, htmlBody: finalHtml });

        if (sendResult.status) {
          totalSent++;
          sentTo.push(parentEmail);
          console.log("✅ Email sent successfully");
        } else {
          errors.push({ leadId: lead.id, parentEmail, error: sendResult.message });
          console.log("❌ Email failed:", sendResult.message);
        }
      } catch (err) {
        console.error(`❌ Error sending email for lead ${lead.id}:`, err);
        errors.push({ leadId: lead.id, error: err.message });
      }
    }

    console.log("\n📊 Summary:", { totalSent, sentTo, skipped, errors });
    return { status: true, message: "Emails send successfully.", totalSent, sentTo, skipped, errors };
  } catch (error) {
    console.error("❌ sendEmailToFirstParentWithBooking Error:", error);
    return { status: false, message: error.message };
  }
};

exports.cancelOneToOneLeadAndBooking = async (leadId, superAdminId, adminId) => {
  const t = await sequelize.transaction();

  try {

    // Find lead with booking
    const lead = await oneToOneLeads.findOne({
      where: {
        id: leadId,
        [Op.or]: [{ createdBy: adminId }, { createdBy: superAdminId }]
      },
      include: [
        {
          model: OneToOneBooking,
          as: "booking"
        }
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

    // ================================
    // ❌ UPDATE STATUSES ONLY
    // ================================
    await lead.update(
      { status: "cancelled" },
      { transaction: t }
    );

    await booking.update(
      {
        status: "cancelled",
        type: "cancel"
      },
      { transaction: t }
    );

    await t.commit();
    return { status: true, message: "Lead and booking cancelled successfully." };

  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

exports.renewOneToOneLeadAndBooking = async (leadId, superAdminId, adminId) => {
  const t = await sequelize.transaction();

  try {
    const lead = await oneToOneLeads.findOne({
      where: {
        id: leadId,
        [Op.or]: [{ createdBy: adminId }, { createdBy: superAdminId }]
      },
      include: [{ model: OneToOneBooking, as: "booking" }],
      transaction: t,
    });

    if (!lead) {
      await t.rollback();
      return { status: false, message: "Lead not found or unauthorized." };
    }

    const booking = lead.booking;
    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    // 🔄 Renew updates
    await lead.update({ status: "active" }, { transaction: t });
    await booking.update(
      { status: "active", type: "paid" },
      { transaction: t }
    );

    await t.commit();
    return { status: true, message: "Lead & booking renewed successfully." };

  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};
