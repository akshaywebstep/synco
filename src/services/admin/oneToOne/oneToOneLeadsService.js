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
    // if (type) {
    //   whereBooking.type = { [Op.eq]: type.toLowerCase() };
    // }

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
                { model: OneToOneEmergency, as: "emergencyDetails" },
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
      // ✅ Normal Admin → only their own leads
      whereLead.createdBy = adminId;
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

    // ✅ Summary (only active)
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
    const topSalesAgentData = await oneToOneLeads.findOne({
      where: { status: "active" },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          where: { status: "active" },
          attributes: [],
        },
        {
          model: Admin, // your Admin model
          as: "creator", // association alias
          attributes: ["firstName", "lastName"],
        },
      ],
      attributes: [
        "createdBy",
        [fn("COUNT", col("OneToOneLead.id")), "leadCount"],
      ],
      group: [
        "createdBy",
        "creator.id",
        "creator.firstName",
        "creator.lastName",
      ],
      order: [[literal("leadCount"), "DESC"]],
      raw: false,
    });

    // ✅ Properly format the response object
    const topSalesAgent =
      topSalesAgentData && topSalesAgentData.creator
        ? {
          firstName: topSalesAgentData.creator.firstName,
          lastName: topSalesAgentData.creator.lastName,
        }
        : null;

    console.log({
      topSalesAgent,
    });

    // ✅ Agent List (super admin + managed admins)
    let agentList = [];
    if (superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id", "firstName", "lastName", "email"],
      });
      agentList = managedAdmins.map((a) => ({
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
            `${superAdmin.firstName || ""} ${superAdmin.lastName || ""
              }`.trim() || superAdmin.email,
        });
      }
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

    // ✅ Coach List (from all bookings)
    const coachIds = [
      ...new Set(
        formattedData.map((lead) => lead.booking?.coachId).filter(Boolean)
      ),
    ];

    let coachList = [];
    if (coachIds.length) {
      const coaches = await Admin.findAll({
        where: { id: { [Op.in]: coachIds } },
        attributes: ["id", "firstName", "lastName", "email"],
      });
      coachList = coaches.map((c) => ({
        id: c.id,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.email,
      }));
    }

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
          topSalesAgent,
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
        topSalesAgent,
      },
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
             { model: Admin, as: "coach" },
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

    const topSalesAgentData = await oneToOneLeads.findOne({
      where: { status: "active" },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true,
          where: { status: "active" },
          attributes: [],
        },
        {
          model: Admin, // your Admin model
          as: "creator", // association alias
          attributes: ["firstName", "lastName"],
        },
      ],
      attributes: [
        "createdBy",
        [fn("COUNT", col("OneToOneLead.id")), "leadCount"],
      ],
      group: [
        "createdBy",
        "creator.id",
        "creator.firstName",
        "creator.lastName",
      ],
      order: [[literal("leadCount"), "DESC"]],
      raw: false,
    });

    // ✅ Properly format the response object
    const topSalesAgent =
      topSalesAgentData && topSalesAgentData.creator
        ? {
          firstName: topSalesAgentData.creator.firstName,
          lastName: topSalesAgentData.creator.lastName,
        }
        : null;

    console.log({
      topSalesAgent,
    });

    // ✅ Agent List (super admin + managed admins)
    let agentList = [];
    if (superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id", "firstName", "lastName", "email"],
      });
      agentList = managedAdmins.map((a) => ({
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
            `${superAdmin.firstName || ""} ${superAdmin.lastName || ""
              }`.trim() || superAdmin.email,
        });
      }
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

    // ✅ Coach List (from all bookings)
    const coachIds = [
      ...new Set(
        formattedData.map((lead) => lead.booking?.coachId).filter(Boolean)
      ),
    ];

    let coachList = [];
    if (coachIds.length) {
      const coaches = await Admin.findAll({
        where: { id: { [Op.in]: coachIds } },
        attributes: ["id", "firstName", "lastName", "email"],
      });
      coachList = coaches.map((c) => ({
        id: c.id,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.email,
      }));
    }

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
          topSalesAgent,
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
        topSalesAgent,
      },
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
      // 🧩 Normal Admin: only see own leads
      whereLead.createdBy = adminId;
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
            emergencyPhoneNumber: em.phoneNumber,
            emergencyRelation: em.relationChild,
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
    console.log("🔹 Fetching lead with ID:", id);

    const lead = await oneToOneLeads.findOne({
      where: {
        id,
        [Op.or]: [
          { createdBy: adminId },
          { createdBy: superAdminId }
        ]
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
                { model: OneToOneEmergency, as: "emergencyDetails" },
              ],
            },
          ],
        },
      ],
      transaction: t,
    });

    if (!lead) {
      console.log("⚠️ Lead not found or unauthorized");
      await t.rollback();
      return { status: false, message: "Lead not found or unauthorized." };
    }

    const booking = lead.booking;
    if (!booking) {
      console.log("⚠️ Booking not found for this lead");
      await t.rollback();
      return { status: false, message: "Booking not found for this lead." };
    }

    // ======================================================
    // 🧩 STUDENTS
    // ======================================================
    if (updateData?.student && Array.isArray(updateData.student) && updateData.student.length) {
      console.log("🔹 Updating/creating students:", updateData.student);
      for (const studentData of updateData.student) {
        if (studentData.id) {
          const existingStudent = await OneToOneStudent.findOne({
            where: { id: studentData.id, oneToOneBookingId: booking.id },
            transaction: t,
          });
          if (existingStudent) {
            console.log(`🔄 Updating existing student id=${studentData.id}`);
            await existingStudent.update(
              {
                studentFirstName: studentData.studentFirstName ?? existingStudent.studentFirstName,
                studentLastName: studentData.studentLastName ?? existingStudent.studentLastName,
                dateOfBirth: studentData.dateOfBirth ?? existingStudent.dateOfBirth,
                age: studentData.age ?? existingStudent.age,
                gender: studentData.gender ?? existingStudent.gender,
                medicalInfo: studentData.medicalInfo ?? existingStudent.medicalInfo,
              },
              { transaction: t }
            );
            console.log(`✅ Updated student id=${studentData.id}`);
          } else {
            console.log(`⚠️ Student id=${studentData.id} not found, skipping`);
          }
        } else {
          console.log("➕ Creating new student:", studentData);
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
          console.log(`✅ Created new student: ${studentData.studentFirstName} ${studentData.studentLastName}`);
        }
      }
    }

    // ======================================================
    // 👨‍👩‍👧 PARENTS
    // ======================================================
    if (updateData?.parentDetails && Array.isArray(updateData.parentDetails)) {
      console.log("🔹 Updating/creating parent details:", updateData.parentDetails);

      for (const parentData of updateData.parentDetails) {
        if (parentData.id) {
          console.log(`🔄 Attempting to update existing parent id=${parentData.id}`);
          const existingParent = await OneToOneParent.findOne({
            where: { id: parentData.id },
            transaction: t,
          });

          if (existingParent) {
            console.log(`✅ Found parent id=${parentData.id}, updating fields`);
            await existingParent.update(
              {
                parentFirstName: parentData.parentFirstName ?? existingParent.parentFirstName,
                parentLastName: parentData.parentLastName ?? existingParent.parentLastName,
                parentEmail: parentData.parentEmail ?? existingParent.parentEmail,
                phoneNumber: parentData.phoneNumber ?? existingParent.phoneNumber,
                relationChild: parentData.relationChild ?? existingParent.relationChild,
                howDidHear: parentData.howDidHear ?? existingParent.howDidHear,
              },
              { transaction: t }
            );
            console.log('Parent updated:', existingParent.toJSON());
          } else {
            console.log(`⚠️ Parent id=${parentData.id} not found, cannot update`);
          }
        } else if (parentData.studentId) {
          console.log(`➕ Creating new parent for studentId=${parentData.studentId}`);
          const newParent = await OneToOneParent.create(
            {
              studentId: parentData.studentId,
              parentFirstName: parentData.parentFirstName,
              parentLastName: parentData.parentLastName,
              parentEmail: parentData.parentEmail,
              phoneNumber: parentData.phoneNumber,
              relationChild: parentData.relationChild,
              howDidHear: parentData.howDidHear,
            },
            { transaction: t }
          );
          console.log('Parent created:', newParent.toJSON());
        } else {
          console.log("⚠️ Skipping parent entry (no id or studentId provided):", parentData);
        }
      }
    }

    // ======================================================
    // 🚨 EMERGENCY DETAILS
    // ======================================================
    if (updateData?.emergencyDetails && updateData.emergencyDetails.id) {
      console.log(`🔄 Updating emergency details id=${updateData.emergencyDetails.id}`);
      const e = updateData.emergencyDetails;
      const existingEmergency = await OneToOneEmergency.findOne({
        where: { id: e.id },
        transaction: t,
      });
      if (existingEmergency) {
        await existingEmergency.update(
          {
            emergencyFirstName: e.emergencyFirstName ?? existingEmergency.emergencyFirstName,
            emergencyLastName: e.emergencyLastName ?? existingEmergency.emergencyLastName,
            phoneNumber: e.phoneNumber ?? existingEmergency.phoneNumber,
            relationChild: e.relationChild ?? existingEmergency.relationChild,
          },
          { transaction: t }
        );
        console.log(`✅ Updated emergency details id=${e.id}`);
      } else {
        console.log(`⚠️ Emergency details id=${e.id} not found, skipping`);
      }
    }

    // Commit transaction
    await t.commit();
    console.log("✅ Transaction committed successfully");

    return {
      status: true,
      message: "Lead updated successfully.",
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ Error updating one-to-one lead:", error);
    return { status: false, message: error.message };
  }
};

// Get All One-to-One Analytics
exports.getAllOneToOneAnalytics = async (superAdminId, adminId, filterType) => {
  try {
    const whereLead = {}; // ✅ initialize first

    // ✅ Super Admin logic
    if (superAdminId === adminId) {
      // Super admin — include all leads created by self or managed admins
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);

      whereLead.createdBy = { [Op.in]: adminIds };
    } else {
      // Normal admin — include only own leads
      whereLead.createdBy = adminId;
    }
    // 🗓️ Define date ranges dynamically based on filterType
    let startDate, endDate;

    if (filterType === "thisMonth") {
      startDate = moment().startOf("month").toDate();
      endDate = moment().endOf("month").toDate();
    } else if (filterType === "lastMonth") {
      startDate = moment().subtract(1, "month").startOf("month").toDate();
      endDate = moment().subtract(1, "month").endOf("month").toDate();
    } else if (filterType === "last3Months") {
      startDate = moment().subtract(3, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();
    } else if (filterType === "last6Months") {
      startDate = moment().subtract(6, "months").startOf("month").toDate();
      endDate = moment().endOf("month").toDate();
    } else {
      throw new Error(
        "Invalid filterType. Use thisMonth | lastMonth | last3Months | last6Months"
      );
    }

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
      ...whereLead, // includes createdBy: adminId OR createdBy: { [Op.in]: adminIds } for superAdmin
      createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
    };
    const whereLastMonth = {
      ...whereLead,
      createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
    };

    // ✅ Total Leads (scoped to the lead owners determined by whereLead)
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
      include: [
        {
          model: oneToOneLeads,
          as: "lead", // 👈 make sure alias matches your association
          attributes: [],
          where: whereLead, // ✅ filter by lead.createdBy (admin or superAdmin scope)
          required: true,
        },
      ],
    });

    const salesLastMonth = await OneToOneBooking.count({
      where: {
        status: "active",
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
      include: [
        {
          model: oneToOneLeads,
          as: "lead",
          attributes: [],
          where: whereLead, // ✅ same filtering logic
          required: true,
        },
      ],
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

    // ✅ Revenue Generated (based on lead.createdBy)
    const paymentsThisMonth = await OneToOnePayment.findAll({
      attributes: [[fn("SUM", col("OneToOnePayment.amount")), "total"]],
      include: [
        {
          model: OneToOneBooking,
          as: "booking", // 👈 must match your association
          attributes: [],
          include: [
            {
              model: oneToOneLeads,
              as: "lead",
              attributes: [],
              where: whereLead, // ✅ filter by lead.createdBy (admin/superAdmin scope)
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
      raw: true,
    });

    const paymentsLastMonth = await OneToOnePayment.findAll({
      attributes: [[fn("SUM", col("OneToOnePayment.amount")), "total"]],
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
              where: whereLead, // ✅ same filtering logic for last month
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
      raw: true,
    });

    const revenueThisMonth = paymentsThisMonth[0]?.total || 0;
    const revenueLastMonth = paymentsLastMonth[0]?.total || 0;

    const packages = ["Gold", "Silver", "Platinum"];

    // ✅ Fetch revenue by package (THIS MONTH)
    // const revenueThisMonthRaw = await OneToOnePayment.findAll({
    //   attributes: [
    //     [col("booking.lead.packageInterest"), "packageName"],
    //     [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
    //   ],
    //   include: [
    //     {
    //       model: OneToOneBooking,
    //       as: "booking",
    //       attributes: [],
    //       include: [
    //         {
    //           model: oneToOneLeads,
    //           as: "lead",
    //           attributes: [],
    //           where: {
    //             ...whereLead, // ✅ filter by lead.createdBy (admin or superAdmin)
    //             packageInterest: { [Op.in]: packages },
    //           },
    //           required: true,
    //         },
    //       ],
    //       required: true,
    //     },
    //   ],
    //   where: {
    //     createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
    //   },
    //   group: ["booking.lead.packageInterest"],
    //   raw: true,
    // });

    // // ✅ Fetch revenue by package (LAST MONTH)
    // const revenueLastMonthRaw = await OneToOnePayment.findAll({
    //   attributes: [
    //     [col("booking.lead.packageInterest"), "packageName"],
    //     [fn("SUM", col("OneToOnePayment.amount")), "totalRevenue"],
    //   ],
    //   include: [
    //     {
    //       model: OneToOneBooking,
    //       as: "booking",
    //       attributes: [],
    //       include: [
    //         {
    //           model: oneToOneLeads,
    //           as: "lead",
    //           attributes: [],
    //           where: {
    //             ...whereLead, // ✅ same filter for last month
    //             packageInterest: { [Op.in]: packages },
    //           },
    //           required: true,
    //         },
    //       ],
    //       required: true,
    //     },
    //   ],
    //   where: {
    //     createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
    //   },
    //   group: ["booking.lead.packageInterest"],
    //   raw: true,
    // });

    // ✅ Source Breakdown (Marketing)
    const sourceBreakdown = await oneToOneLeads.findAll({
      where: whereLead, // ✅ filter by createdBy (admin or superAdmin scope)
      attributes: ["source", [fn("COUNT", col("source")), "count"]],
      group: ["source"],
      raw: true,
    });

    // ✅ Top Agents
    const topAgents = await oneToOneLeads.findAll({
      where: whereLead, // ✅ filter by same createdBy logic
      attributes: ["createdBy", [fn("COUNT", col("createdBy")), "leadCount"]],
      include: [
        {
          model: Admin,
          as: "creator",
          attributes: ["id", "firstName", "lastName", "profile"], // ✅ include profile pic
        },
      ],
      group: ["createdBy", "creator.id"], // ✅ include all group fields
      order: [[literal("leadCount"), "DESC"]],
    });

    // ✅ One-to-One Students (monthly trend — show all months)
    const monthlyStudentsRaw = await OneToOneBooking.findAll({
      attributes: [
        [fn("DATE_FORMAT", col("OneToOneBooking.createdAt"), "%M"), "month"], // e.g. "October"
        [fn("COUNT", col("OneToOneBooking.id")), "bookings"], // total bookings
        [fn("COUNT", fn("DISTINCT", col("students.id"))), "students"], // unique students linked to those bookings
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
        status: { [Op.in]: ["pending", "active"] },
        createdAt: {
          [Op.between]: [
            moment().startOf("year").toDate(),
            moment().endOf("year").toDate(),
          ],
        },
      },
      group: [fn("MONTH", col("OneToOneBooking.createdAt"))],
      order: [[fn("MONTH", col("OneToOneBooking.createdAt")), "ASC"]],
      raw: true,
    });

    // 🧠 Generate all 12 months (Jan → Dec)
    const allMonths = Array.from({ length: 12 }, (_, i) => ({
      month: moment().month(i).format("MMMM"),
      students: 0,
      bookings: 0,
    }));

    // 🧩 Merge DB results into allMonths
    const monthlyStudents = allMonths.map((m) => {
      const found = monthlyStudentsRaw.find((r) => r.month === m.month);
      return {
        month: m.month,
        students: found ? parseInt(found.students, 10) : 0,
        bookings: found ? parseInt(found.bookings, 10) : 0,
      };
    });

    // ✅ Package Breakdown (filtered by lead.createdBy)
    const packageBreakdown = await oneToOneLeads.findAll({
      attributes: [
        ["packageInterest", "packageName"], // e.g., Gold / Silver / Platinum
        [fn("COUNT", col("packageInterest")), "count"],
      ],
      where: {
        ...whereLead, // ✅ add lead.createdBy filter here
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
    const formattedPackages = packageBreakdown.map((pkg) => {
      const count = parseInt(pkg.count, 10);
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
    const renewalBreakdown = ["Gold", "Silver", "Platinum"].map((pkgName) => {
      const found = renewalBreakdownRaw.find((r) => r.packageName === pkgName);
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
    const revenueByPackage = ["Gold", "Silver", "Platinum"].map((pkgName) => {
      const current = revenueByPackageRaw.find(
        (r) => r.packageName === pkgName
      );
      const last = revenueByPackageLastMonth.find(
        (r) => r.packageName === pkgName
      );

      const currentRevenue = current
        ? parseFloat(current.totalRevenue || 0)
        : 0;
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
      attributes: ["source", [fn("COUNT", col("source")), "count"]],
      where: {
        ...whereLead, // ✅ filter by createdBy (admin or superAdmin scope)
        source: { [Op.ne]: null }, // exclude null sources
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
        [fn("COUNT", col("OneToOneStudent.id")), "count"],
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
              where: { ...whereLead }, // ✅ filter by lead.createdBy (scope)
              required: true,
            },
          ],
          required: true,
        },
      ],
      group: ["age", "gender"],
      order: [[literal("count"), "DESC"]],
      raw: true,
    });

    // 🧠 Format data for frontend (progress bar UI)
    const totalBookings = partyBookingRaw.reduce(
      (sum, s) => sum + parseInt(s.count, 10),
      0
    );

    // 2️⃣ Group by Age
    const byAgeMap = {};
    partyBookingRaw.forEach((s) => {
      const age = s.age || "Unknown";
      const count = parseInt(s.count, 10);
      byAgeMap[age] = (byAgeMap[age] || 0) + count;
    });

    const byAge = Object.entries(byAgeMap).map(([age, count]) => ({
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
      const count = parseInt(s.count, 10);
      byGenderMap[gender] = (byGenderMap[gender] || 0) + count;
    });

    const byGender = Object.entries(byGenderMap).map(([gender, count]) => ({
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
    const categoryMap = {
      Gold: "revenue",
      Platinum: "revenue",
      Silver: "growth",
      Bronze: "growth",
    };

    // ✅ Package Background Breakdown (filtered by createdBy)
    const packageBackgroundRaw = await oneToOneLeads.findAll({
      attributes: ["packageInterest", [fn("COUNT", col("id")), "count"]],
      where: {
        ...whereLead, // ✅ restrict by lead.createdBy (admin or superAdmin)
      },
      group: ["packageInterest"],
      order: [[literal("count"), "DESC"]],
      raw: true,
    });

    // Calculate total
    const grouped = {};
    packageBackgroundRaw.forEach((s) => {
      const pkg = s.packageInterest || "Unknown";
      const count = parseInt(s.count, 10);
      const category = categoryMap[pkg] || "other";

      const percentage =
        totalPackages > 0
          ? parseFloat(((count / totalPackages) * 100).toFixed(2))
          : 0;

      if (!grouped[category]) grouped[category] = [];

      grouped[category].push({
        name: pkg,
        count,
        percentage,
      });
    });

    const packageBackground = Object.entries(grouped).map(
      ([category, items]) => ({
        [category]: items,
      })
    );

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
        // revenueThisMonthRaw: {
        //   thisMonth: revenueThisMonthRaw,
        //   previousMonth: revenueLastMonthRaw,
        // },
      },
      charts: {
        monthlyStudents, // for line chart
        // revenueByPackage, // donut chart
        marketChannelPerformance,
        sourceBreakdown, // marketing channels
        topAgents, // top agents
        partyBooking,
        packageBackground,
        renewalBreakdown, // renewal chart
        packageBreakdown: formattedPackages,
        revenueByPackage,
      },
    };
  } catch (error) {
    console.error("❌ Error fetching One-to-One analytics:", error);
    return { status: false, message: error.message };
  }
};
exports.sendEmailToFirstParentWithBooking = async (leadIds = []) => {
  try {
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return { status: false, message: "Please provide at least one leadId." };
    }

    // 🧩 Fetch only the leads with the selected IDs that have at least one booking
    const leadsWithBooking = await oneToOneLeads.findAll({
      where: { id: leadIds },
      include: [
        {
          model: OneToOneBooking,
          as: "booking",
          required: true, // ensures only leads with booking are returned
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

    if (!leadsWithBooking.length) {
      return {
        status: false,
        message: "No matching leads found with active bookings.",
      };
    }

    // ⚙️ Email configuration
    const emailConfigResult = await getEmailConfig(
      "admin",
      "one-to-one-booking-sendEmail"
    );
    if (!emailConfigResult.status) {
      return { status: false, message: "Email configuration not found." };
    }

    const { emailConfig, htmlTemplate, subject } = emailConfigResult;

    let totalSent = 0;
    const sentTo = [];
    const skipped = [];
    const errors = [];

    // 🧭 Process each selected lead
    for (const lead of leadsWithBooking) {
      try {
        const booking = lead.booking;
        if (!booking || !booking.students || booking.students.length === 0) {
          skipped.push({
            leadId: lead.id,
            reason: "No students found in booking.",
          });
          continue;
        }

        // 👨‍👩‍👧 Get the first parent from the first student (only one email per booking)
        const firstStudent = booking.students[0];
        const firstParent = firstStudent.parentDetails;

        if (!firstParent || !firstParent.parentEmail) {
          skipped.push({
            leadId: lead.id,
            reason: "No valid parent email found.",
          });
          continue;
        }

        // 📅 Booking & Payment Info
        const bookingDate = booking.date || "TBA";
        const bookingTime = booking.time || "TBA";
        const location = booking.location || "Not specified";
        const address = booking.address || "Not specified";
        const packageName = lead.packageInterest || "N/A";
        const paymentStatus = booking.payment?.paymentStatus || "unknown";
        const paymentAmount = booking.payment?.amount || "0.00";

        // 🧒 Student Info (all students)
        const studentNames = booking.students
          .map((s) => `${s.studentFirstName} ${s.studentLastName}`)
          .join(", ");

        // 🧠 Replace placeholders in email template
        const finalHtml = htmlTemplate
          .replace(
            /{{parentName}}/g,
            `${firstParent.parentFirstName} ${firstParent.parentLastName}`.trim()
          )
          .replace(/{{studentNames}}/g, studentNames)
          .replace(/{{packageName}}/g, packageName)
          .replace(/{{location}}/g, location)
          .replace(/{{address}}/g, address)
          .replace(/{{date}}/g, bookingDate)
          .replace(/{{time}}/g, bookingTime)
          .replace(/{{paymentStatus}}/g, paymentStatus)
          .replace(/{{amount}}/g, paymentAmount)
          .replace(/{{relationChild}}/g, firstParent.relationChild || "Parent")
          .replace(/{{appName}}/g, "Synco")
          .replace(/{{year}}/g, new Date().getFullYear());

        const recipient = [
          {
            name: `${firstParent.parentFirstName} ${firstParent.parentLastName}`,
            email: firstParent.parentEmail,
          },
        ];

        // 📧 Send the email
        const sendResult = await sendEmail(emailConfig, {
          recipient,
          subject,
          htmlBody: finalHtml,
        });

        if (sendResult.status) {
          totalSent++;
          sentTo.push(firstParent.parentEmail);
        } else {
          errors.push({
            leadId: lead.id,
            parentEmail: firstParent.parentEmail,
            error: sendResult.message,
          });
        }
      } catch (err) {
        console.error(`❌ Error sending email for lead ${lead.id}:`, err);
        errors.push({ leadId: lead.id, error: err.message });
      }
    }

    // ✅ Final Response
    return {
      status: true,
      message: `Emails sent to parents successfully.`,
      totalSent,
      sentTo,
      skipped,
      errors,
    };
  } catch (error) {
    console.error("❌ sendEmailToFirstParentWithBooking Error:", error);
    return { status: false, message: error.message };
  }
};
