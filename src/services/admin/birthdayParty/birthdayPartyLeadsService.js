const {
  BirthdayPartyLead,
  BirthdayPartyBooking,
  BirthdayPartyStudent,
  BirthdayPartyParent,
  BirthdayPartyEmergency,
  BirthdayPartyPayment,
  PaymentPlan,
  Admin,
  sequelize,
} = require("../../../models");
const { Op, fn, col, literal } = require("sequelize");
const stripePromise = require("../../../utils/payment/pay360/stripe");
const { getEmailConfig } = require("../../email");
const sendEmail = require("../../../utils/email/sendEmail");
const moment = require("moment");
const useOrDefault = (data, fallback) =>
  Array.isArray(data) && data.length > 0 ? data : fallback;

// Helper to calculate percentage change average
function calculateAverage(current, previous) {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100; // or +Infinity, decide how to handle no previous data
  return Math.round(((current - previous) / previous) * 100);
}
// ✅ Create
exports.createBirthdayPartyLeads = async (data) => {
  try {
    const birthdayParty = await BirthdayPartyLead.create(data);
    return { status: true, data: birthdayParty.get({ plain: true }) };
  } catch (error) {
    console.error("❌ Error creating birthdayParty lead:", error);
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
    const leads = await BirthdayPartyLead.findAll({
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
    await BirthdayPartyLead.update(
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
exports.getAllBirthdayPartyLeads = async (
  superAdminId,
  adminId,
  filters = {}
) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    const { fromDate, toDate, type, studentName, partyDate, packageInterest } =
      filters;

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

    // ✅ Type filter (if provided)

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

    // ✅ Package Interest filter
    if (packageInterest) {
      whereLead.packageInterest = { [Op.eq]: packageInterest.toLowerCase() };
    }

    // ✅ Party Date filter
    if (partyDate) {
      whereLead.partyDate = { [Op.eq]: partyDate.toLowerCase() };
    }
    // ✅ Fetch leads
    const leads = await BirthdayPartyLead.findAll({
      where: whereLead,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          required: !!type,
          where: whereBooking,
          include: [
            {
              model: BirthdayPartyStudent,
              as: "students",
              include: [
                { model: BirthdayPartyParent, as: "parentDetails" },
                {
                  model: BirthdayPartyEmergency, as: "emergencyDetails", attributes: [
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
            { model: BirthdayPartyPayment, as: "payment" },
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
            type: booking.type,
            address: booking.address,
            date: booking.date,
            time: booking.time,
            capacity: booking.capacity,
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
    // In your existing function, after filters and data fetching, replace the summary block with:

    // Dates
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
      baseWhere.createdBy = { [Op.in]: adminIds };
    } else {
      baseWhere.createdBy = { [Op.in]: [adminId, superAdminId] };
    }

    // 1. totalLeads: leads WITHOUT booking in current year
    const totalLeadsThisYear = await BirthdayPartyLead.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] },
      },
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          required: false,
          where: { id: null }, // no booking
        },
      ],
    });

    const totalLeadsLastYear = await BirthdayPartyLead.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfLastYear, endOfLastYear] },
      },
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          required: false,
          where: { id: null }, // no booking
        },
      ],
    });

    const totalLeadsAverage = calculateAverage(totalLeadsThisYear, totalLeadsLastYear);

    // 2. newLeads: leads created THIS MONTH, average change from last month
    const newLeadsThisMonth = await BirthdayPartyLead.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
    });

    const newLeadsLastMonth = await BirthdayPartyLead.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
    });

    const newLeadsAverage = calculateAverage(newLeadsThisMonth, newLeadsLastMonth);

    // 3. leadsWithBookings: leads WITH booking in current year, average from last year
    const leadsWithBookingsThisYear = await BirthdayPartyLead.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] },
      },
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          required: true,
          where: { status: "pending" },
        },
      ],
    });

    const leadsWithBookingsLastYear = await BirthdayPartyLead.count({
      where: {
        ...baseWhere,
        createdAt: { [Op.between]: [startOfLastYear, endOfLastYear] },
      },
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          required: true,
          where: { status: "pending" },
        },
      ],
    });

    const leadsWithBookingsAverage = calculateAverage(leadsWithBookingsThisYear, leadsWithBookingsLastYear);

    // 4. sourceOfBookings (grouped, no date filter here but you can add if needed)
    const sourceCount = await BirthdayPartyLead.findAll({
      where: baseWhere,
      attributes: [
        "source",
        [sequelize.fn("COUNT", sequelize.col("source")), "count"],
      ],
      group: ["source"],
    });

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
    // Return with proper message if no leads after filtering
    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary,
        data: [],
      };
    }

    return {
      status: true,
      message: "Fetched birthday party leads successfully.",
      summary,
      data: formattedData,
    };
  } catch (error) {
    console.error("❌ Error fetching birthdayParty leads:", error);
    return { status: false, message: error.message };
  }
};
// Get All Sales
exports.getAllBirthdayPartyLeadsSales = async (
  superAdminId,
  adminId,
  filters = {}
) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    const { fromDate, toDate, type, studentName, packageInterest, partyDate } =
      filters;

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
    } else if (superAdminId && adminId) {
      // 🟢 Admin → fetch own + super admin’s leads
      whereLead.createdBy = { [Op.in]: [adminId, superAdminId] };
    } else {
      // 🟢 Fallback (in case no superAdminId found)
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

    // ✅ Package Interest filter
    if (packageInterest) {
      whereLead.packageInterest = { [Op.eq]: packageInterest.toLowerCase() };
    }

    // ✅ Party Date filter
    if (partyDate) {
      whereLead.partyDate = { [Op.eq]: partyDate.toLowerCase() };
    }

    const leads = await BirthdayPartyLead.findAll({
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
          model: BirthdayPartyBooking,
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
              model: BirthdayPartyStudent,
              as: "students",
              include: [
                { model: BirthdayPartyParent, as: "parentDetails" },
                {
                  model: BirthdayPartyEmergency, as: "emergencyDetails", attributes: [
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
            { model: BirthdayPartyPayment, as: "payment" },
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

    const startOfThisMonth = moment().startOf("month").toDate();
    const endOfThisMonth = moment().endOf("month").toDate();

    const startOfLastMonth = moment().subtract(1, "month").startOf("month").toDate();
    const endOfLastMonth = moment().subtract(1, "month").endOf("month").toDate();

    const percent = (curr, prev) => {
      if (!prev) return "+100%";
      const val = Math.round(((curr - prev) / prev) * 100);
      return `${val >= 0 ? "+" : ""}${val}%`;
    };

    const totalRevenueThisMonth = await BirthdayPartyPayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
    });

    const totalRevenueLastMonth = await BirthdayPartyPayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
    });

    const getSourceRevenue = async (packageInterest, start, end) => {
      return await BirthdayPartyPayment.sum("amount", {
        include: [
          {
            model: BirthdayPartyBooking,
            as: "booking",
            required: true,
            include: [
              {
                model: BirthdayPartyLead,
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
    const topSalesAgent = await BirthdayPartyLead.findOne({
      attributes: [
        "createdBy",
        [sequelize.fn("COUNT", sequelize.col("BirthdayPartyLead.id")), "leadCount"],
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
      group: ["createdBy", "creator.id"],
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

    // console.log({ topSalesAgent });

    // ✅ Final Response
    if (!filteredLeads.length) {
      return {
        status: true,
        message: "No leads found for the selected filters.",
        summary,
      };
    }

    return {
      status: true,
      message: "Fetched Birthday party leads successfully.",
      summary,
      data: formattedData,
    };
  } catch (error) {
    console.error("❌ Error fetching birthdayparty leads:", error);
    return { status: false, message: error.message };
  }
};

// Get All Sales and Leads both
exports.getAllBirthdayPartyLeadsSalesAll = async (
  superAdminId,
  adminId,
  filters = {}
) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    const { fromDate, toDate, type, studentName, packageInterest, partyDate, source, coach,
      agent, address } =
      filters;

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
    } else if (superAdminId && adminId) {
      // 🟢 Admin → fetch own + super admin’s leads
      whereLead.createdBy = { [Op.in]: [adminId, superAdminId] };
    } else {
      // 🟢 Fallback (in case no superAdminId found)
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
      whereLead.packageInterest = { [Op.eq]: packageInterest.toLowerCase() };
    }

    // ✅ Party Date filter
    if (partyDate) {
      whereLead.partyDate = { [Op.eq]: partyDate.toLowerCase() };
    }

    if (source) {
      whereLead.source = { [Op.eq]: source.toLowerCase() };
    }
    // ✅ Address filter
    if (address) {
      whereBooking.address = {
        [Op.like]: `%${address}%`,   // allows partial match
      };
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

    const hasBookingFilters = Object.keys(whereBooking).length > 0;

    const leads = await BirthdayPartyLead.findAll({
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
          model: BirthdayPartyBooking,
          as: "booking",

          // JOIN LOGIC
          required: type ? true : hasBookingFilters,

          // WHERE LOGIC
          where:
            type || hasBookingFilters
              ? {
                ...(type ? { type: { [Op.eq]: type.toLowerCase() } } : {}),
                ...whereBooking,
              }
              : undefined,

          include: [
            {
              model: BirthdayPartyStudent,
              as: "students",
              include: [
                { model: BirthdayPartyParent, as: "parentDetails" },
                {
                  model: BirthdayPartyEmergency, as: "emergencyDetails", attributes: [
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
            { model: BirthdayPartyPayment, as: "payment" },
            { model: PaymentPlan, as: "paymentPlan" },
            { model: Admin, as: "coach" },
          ],
        }

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
            id: booking.id,
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

    const totalRevenueThisMonth = await BirthdayPartyPayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfThisMonth, endOfThisMonth] },
      },
    });

    const totalRevenueLastMonth = await BirthdayPartyPayment.sum("amount", {
      where: {
        paymentStatus: "paid",
        createdAt: { [Op.between]: [startOfLastMonth, endOfLastMonth] },
      },
    });

    const getSourceRevenue = async (packageInterest, start, end) => {
      return await BirthdayPartyPayment.sum("amount", {
        include: [
          {
            model: BirthdayPartyBooking,
            as: "booking",
            required: true,
            include: [
              {
                model: BirthdayPartyLead,
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

    const topSalesAgent = await BirthdayPartyLead.findOne({
      attributes: [
        "createdBy",
        [sequelize.fn("COUNT", sequelize.col("BirthdayPartyLead.id")), "leadCount"],
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
      group: ["createdBy", "creator.id"],
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
            `${superAdmin.firstName || ""} ${superAdmin.lastName || ""}`.trim() ||
            superAdmin.email,
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
    if (!formattedData.length) {
      return {
        status: true,
        message: "No birthday party leads found for the selected filters.",
        summary,
        agentList,
        coachList,
        data: [],
      };
    }

    return {
      status: true,
      message: "Fetched Birthday Party leads successfully.",
      summary,
      agentList,
      coachList,
      data: formattedData,
    };
  } catch (error) {
    console.error("❌ Error fetching birthdayParty leads:", error);
    return { status: false, message: error.message };
  }
};

exports.getBirthdayPartyLeadsById = async (id, adminId, superAdminId) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return { status: false, message: "Invalid admin ID.", data: [] };
    }

    // ✅ Declare whereLead with lead id
    const whereLead = { id };

    // 🔐 Visibility rules
    if (superAdminId === adminId) {
      // 🔵 SUPER ADMIN → see all managed admins + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);

      whereLead.createdBy = { [Op.in]: adminIds };

    } else if (superAdminId && adminId) {
      // 🟢 ADMIN → see ONLY self + super admin
      whereLead.createdBy = {
        [Op.in]: [adminId, superAdminId],
      };

    } else {
      // 🟡 Safety fallback
      whereLead.createdBy = adminId;
    }

    // ✅ Query lead
    const lead = await BirthdayPartyLead.findOne({
      where: { id, ...whereLead },
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          required: false,
          include: [
            {
              model: BirthdayPartyStudent,
              as: "students",
              include: [
                { model: BirthdayPartyParent, as: "parentDetails" },
                {
                  model: BirthdayPartyEmergency, as: "emergencyDetails", attributes: [
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
            { model: BirthdayPartyPayment, as: "payment" },
            { model: PaymentPlan, as: "paymentPlan" },
            { model: Admin, as: "coach" },
          ],
        },
      ],
    });

    if (!lead) {
      return {
        status: false,
        message: "Birthday party lead not found or unauthorized.",
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
    const parents = (booking.students || []).flatMap((s) =>
      (s.parentDetails || []).map((p) => ({
        id: p.id,
        studentId: s.id, // link parent to correct student
        parentFirstName: p.parentFirstName,
        parentLastName: p.parentLastName,
        parentEmail: p.parentEmail,
        phoneNumber: p.phoneNumber,
        relationChild: p.relationChild,
        howDidHear: p.howDidHear,
      }))
    );

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
        emergencyPhoneNumber: emergencyObj.emergencyPhoneNumber,
        emergencyRelation: emergencyObj.emergencyRelation,
      }
      : null;

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
      packageInterest: leadPlain.packageInterest,
      partyDate: leadPlain.partyDate,
      source: leadPlain.source,
      status: leadPlain.status,
      createdBy: leadPlain.createdBy,
      createdAt: leadPlain.createdAt,
      updatedAt: leadPlain.updatedAt,

      booking: {
        id: booking.id,
        serviceType: booking.serviceType,
        leadId: booking.leadId,
        coachId: booking.coachId,
        coach: booking.coach,
        address: booking.address,
        date: booking.date,
        time: booking.time,
        capacity: booking.capacity,
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
exports.updateBirthdayPartyLeadById = async (id, superAdminId, adminId, updateData) => {
  const t = await sequelize.transaction();
  try {
    console.log("🎉 Fetching Birthday Party Lead ID:", id);

    const lead = await BirthdayPartyLead.findOne({
      where: {
        id,
        [Op.or]: [{ createdBy: adminId }, { createdBy: superAdminId }]
      },
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          include: [
            {
              model: BirthdayPartyStudent,
              as: "students",
              include: [
                { model: BirthdayPartyParent, as: "parentDetails" },
                {
                  model: BirthdayPartyEmergency, as: "emergencyDetails", attributes: [
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
      return { status: false, message: "Birthday Party lead not found or unauthorized." };
    }

    const booking = lead.booking;
    if (!booking) {
      await t.rollback();
      return { status: false, message: "Birthday Party booking not found for this lead." };
    }

    // ======================================================
    // 🧒 STUDENTS (STRICT VALIDATION)
    // ======================================================
    if (Array.isArray(updateData?.student)) {
      for (const s of updateData.student) {

        // ---------- UPDATE ----------
        if (s.id) {
          const existingStudent = await BirthdayPartyStudent.findOne({
            where: { id: s.id, birthdayPartyBookingId: booking.id },
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

        await BirthdayPartyStudent.create(
          {
            birthdayPartyBookingId: booking.id,
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
    // 👨‍👩‍👧 PARENTS (STRICT VALIDATION)
    // ======================================================
    if (Array.isArray(updateData?.parentDetails)) {
      for (const p of updateData.parentDetails) {

        // ---------- UPDATE ----------
        if (p.id) {
          const existingParent = await BirthdayPartyParent.findOne({
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
          continue;
        }

        // ---------- CREATE (STRICT: DO NOT SAVE EMPTY) ----------
        const requiredParentFields = [
          "parentFirstName",
          "parentLastName",
          "parentEmail",
          "phoneNumber",
          "relationChild",
          "studentId"
        ];
        const missing = requiredParentFields.filter(f => !p[f] || String(p[f]).trim() === "");
        if (missing.length > 0) {
          await t.rollback();
          return { status: false, message: `Missing required fields: ${missing.join(", ")}` };
        }

        await BirthdayPartyParent.create(
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
    }

    // ======================================================
    // 🚨 EMERGENCY DETAILS (STRICT VALIDATION)
    // ======================================================
    // ======================================================
    // 🚨 EMERGENCY DETAILS (STRICT VALIDATION)
    // ======================================================
    if (updateData?.emergencyDetails) {
      const e = updateData.emergencyDetails;

      // ---------- UPDATE ----------
      if (e.id) {
        const existingEmergency = await BirthdayPartyEmergency.findOne({
          where: { id: e.id },
          transaction: t,
        });

        if (!existingEmergency) {
          await t.rollback();
          return { status: false, message: "Emergency contact not found." };
        }

        await existingEmergency.update(
          {
            emergencyFirstName: e.emergencyFirstName ?? existingEmergency.emergencyFirstName,
            emergencyLastName: e.emergencyLastName ?? existingEmergency.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber ?? existingEmergency.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation ?? existingEmergency.emergencyRelation,
          },
          { transaction: t }
        );
      } else {
        // ---------- CREATE ----------
        const requiredEmergency = [
          "emergencyFirstName",
          "emergencyLastName",
          "emergencyPhoneNumber",
          "emergencyRelation",
          "studentId"
        ];

        const missing = requiredEmergency.filter(
          f => !e[f] || String(e[f]).trim() === ""
        );

        if (missing.length > 0) {
          await t.rollback();
          return { status: false, message: `Missing required fields: ${missing.join(", ")}` };
        }

        await BirthdayPartyEmergency.create(
          {
            studentId: e.studentId,
            emergencyFirstName: e.emergencyFirstName,
            emergencyLastName: e.emergencyLastName,
            emergencyPhoneNumber: e.emergencyPhoneNumber,
            emergencyRelation: e.emergencyRelation,
          },
          { transaction: t }
        );
      }
    }

    await t.commit();
    return { status: true, message: "Birthday Party lead updated successfully." };

  } catch (error) {
    await t.rollback();
    return { status: false, message: error.message };
  }
};

// exports.updateBirthdayPartyLeadById = async (id, superAdminId, adminId, updateData) => {
//   const t = await sequelize.transaction();
//   try {
//     console.log("🎉 Fetching Birthday Party Lead ID:", id);

//     const lead = await BirthdayPartyLead.findOne({
//       where: {
//         id,
//         [Op.or]: [
//           { createdBy: adminId },
//           { createdBy: superAdminId }
//         ]
//       },
//       include: [
//         {
//           model: BirthdayPartyBooking,
//           as: "booking",
//           include: [
//             {
//               model: BirthdayPartyStudent,
//               as: "students",
//               include: [
//                 { model: BirthdayPartyParent, as: "parentDetails" },
//                 { model: BirthdayPartyEmergency, as: "emergencyDetails" },
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
//       return { status: false, message: "Birthday Party lead not found or unauthorized." };
//     }

//     const booking = lead.booking;
//     if (!booking) {
//       console.log("⚠️ Booking not found");
//       await t.rollback();
//       return { status: false, message: "Birthday Party booking not found for this lead." };
//     }

//     // ======================================================
//     // 🧒 STUDENTS
//     // ======================================================
//     if (updateData?.student && Array.isArray(updateData.student)) {
//       console.log("🔹 Updating students…");

//       for (const s of updateData.student) {
//         if (s.id) {
//           const existingStudent = await BirthdayPartyStudent.findOne({
//             where: { id: s.id, BirthdayPartyBookingId: booking.id },
//             transaction: t,
//           });

//           if (existingStudent) {
//             console.log(`🔄 Updating student #${s.id}`);
//             await existingStudent.update(
//               {
//                 studentFirstName: s.studentFirstName ?? existingStudent.studentFirstName,
//                 studentLastName: s.studentLastName ?? existingStudent.studentLastName,
//                 dateOfBirth: s.dateOfBirth ?? existingStudent.dateOfBirth,
//                 age: s.age ?? existingStudent.age,
//                 gender: s.gender ?? existingStudent.gender,
//                 medicalInfo: s.medicalInfo ?? existingStudent.medicalInfo,
//               },
//               { transaction: t }
//             );
//           }
//         } else {
//           console.log("➕ Creating new student…");
//           await BirthdayPartyStudent.create(
//             {
//               BirthdayPartyBookingId: booking.id,
//               studentFirstName: s.studentFirstName,
//               studentLastName: s.studentLastName,
//               dateOfBirth: s.dateOfBirth,
//               age: s.age,
//               gender: s.gender,
//               medicalInfo: s.medicalInfo,
//             },
//             { transaction: t }
//           );
//         }
//       }
//     }

//     // ======================================================
//     // 👨‍👩‍👧 PARENTS
//     // ======================================================
//     if (updateData?.parentDetails && Array.isArray(updateData.parentDetails)) {
//       console.log("🔹 Updating parent details…");

//       for (const p of updateData.parentDetails) {
//         if (p.id) {
//           const existingParent = await BirthdayPartyParent.findOne({
//             where: { id: p.id },
//             transaction: t,
//           });

//           if (existingParent) {
//             console.log(`🔄 Updating parent #${p.id}`);
//             await existingParent.update(
//               {
//                 parentFirstName: p.parentFirstName ?? existingParent.parentFirstName,
//                 parentLastName: p.parentLastName ?? existingParent.parentLastName,
//                 parentEmail: p.parentEmail ?? existingParent.parentEmail,
//                 phoneNumber: p.phoneNumber ?? existingParent.phoneNumber,
//                 relationChild: p.relationChild ?? existingParent.relationChild,
//                 howDidHear: p.howDidHear ?? existingParent.howDidHear,
//               },
//               { transaction: t }
//             );
//           }
//         } else if (p.studentId) {
//           console.log("➕ Creating new parent…");
//           await BirthdayPartyParent.create(
//             {
//               studentId: p.studentId,
//               parentFirstName: p.parentFirstName,
//               parentLastName: p.parentLastName,
//               parentEmail: p.parentEmail,
//               phoneNumber: p.phoneNumber,
//               relationChild: p.relationChild,
//               howDidHear: p.howDidHear,
//             },
//             { transaction: t }
//           );
//         }
//       }
//     }

//     // ======================================================
//     // 🚨 EMERGENCY DETAILS
//     // ======================================================
//     if (updateData?.emergencyDetails && updateData.emergencyDetails.id) {
//       const e = updateData.emergencyDetails;

//       const existingEmergency = await BirthdayPartyEmergency.findOne({
//         where: { id: e.id },
//         transaction: t,
//       });

//       if (existingEmergency) {
//         console.log(`🔄 Updating emergency contact #${e.id}`);
//         await existingEmergency.update(
//           {
//             emergencyFirstName: e.emergencyFirstName ?? existingEmergency.emergencyFirstName,
//             emergencyLastName: e.emergencyLastName ?? existingEmergency.emergencyLastName,
//             phoneNumber: e.phoneNumber ?? existingEmergency.phoneNumber,
//             relationChild: e.relationChild ?? existingEmergency.relationChild,
//           },
//           { transaction: t }
//         );
//       }
//     }

//     // ======================================================
//     // ✔ Commit
//     // ======================================================
//     await t.commit();
//     console.log("✅ Birthday Party lead updated successfully");

//     return {
//       status: true,
//       message: "Birthday Party lead updated successfully.",
//     };
//   } catch (error) {
//     await t.rollback();
//     console.error("❌ Error updating Birthday Party lead:", error);
//     return { status: false, message: error.message };
//   }
// };

// Get All Birthday Party Analytics

exports.getAllBirthdayPartyAnalytics = async (
  superAdminId,
  adminId,
  filterType
) => {
  try {
    const currentYear = moment().year();
    const lastYear = currentYear - 1;

    const defaultMonthlyStudents = () =>
      Array.from({ length: 12 }, (_, i) => ({
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

    const whereLead = {}; // base

    if (superAdminId && superAdminId === adminId) {
      // 🟣 SUPER ADMIN
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      const adminIds = managedAdmins.map(a => a.id);
      adminIds.push(superAdminId);

      whereLead[Op.or] = [
        { createdBy: { [Op.in]: adminIds } },
        { createdBy: null }
      ];
    }
    else if (superAdminId && adminId) {
      // 🟢 ADMIN
      whereLead[Op.or] = [
        { createdBy: { [Op.in]: [adminId, superAdminId] } },
        { createdBy: null }
      ];
    }
    else {
      // 🔵 FALLBACK
      whereLead[Op.or] = [
        { createdBy: adminId },
        { createdBy: null }
      ];
    }

    // 🗓️ Default date ranges
    const startOfThisYear = moment().startOf("year").toDate();
    const endOfThisYear = moment().endOf("year").toDate();

    let startDate = moment().startOf("year").toDate();
    let endDate = moment().endOf("year").toDate();

    const buildLeadWhere = (startDate, endDate) => ({
      [Op.and]: [
        whereLead,
        { createdAt: { [Op.between]: [startDate, endDate] } }
      ]
    });

    // Apply filterType overrides
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
    }

    const activeStartDate = startDate;
    const activeEndDate = endDate;

    // ✅ Default: FULL LAST YEAR (Jan–Dec)
    let activeLastYearStartDate = moment().subtract(1, "year").startOf("year").toDate();
    let activeLastYearEndDate = moment().subtract(1, "year").endOf("year").toDate();

    // 🔁 If you REALLY want same-period comparison (optional)
    if (filterType) {
      activeLastYearStartDate = moment(startDate).subtract(1, "year").toDate();
      activeLastYearEndDate = moment(endDate).subtract(1, "year").toDate();
    }

    const whereThisYear = {
      [Op.and]: [
        whereLead
      ],
      createdAt: { [Op.between]: [activeStartDate, activeEndDate] },
    };
    const whereLastYear = {
      [Op.and]: [
        whereLead
      ],
      createdAt: { [Op.between]: [activeLastYearStartDate, activeLastYearEndDate] },
    };

    // ✅ Total Leads (scoped to the lead owners determined by whereLead)
    const totalLeadsThisYear = await BirthdayPartyLead.count({
      where: {
        ...whereThisYear,
        createdAt: { [Op.between]: [activeStartDate, activeEndDate] },
      },
    });

    const totalLeadsLastYear = await BirthdayPartyLead.count({
      where: {
        ...whereLead,
        createdAt: {
          [Op.between]: [activeLastYearStartDate, activeLastYearEndDate]
        }
      }
    });
    // ✅ Number of Sales (active bookings only)
    const salesThisYear = await BirthdayPartyBooking.count({
      where: {
        status: "active",
        createdAt: { [Op.between]: [activeStartDate, activeEndDate] },
      },
      include: [
        {
          model: BirthdayPartyLead,
          as: "lead",
          attributes: [],
          where: whereLead,
          required: true,
        },
      ],
    });

    const salesLastYear = await BirthdayPartyBooking.count({
      where: {
        status: "active",
        createdAt: {
          [Op.between]: [activeLastYearStartDate, activeLastYearEndDate]
        },
      },
      include: [
        {
          model: BirthdayPartyLead,
          as: "lead",
          attributes: [],
          where: whereLead,
          required: true,
        },
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
    const paymentsThisYear = await BirthdayPartyPayment.findAll({
      attributes: [[fn("SUM", col("BirthdayPartyPayment.amount")), "total"]],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: BirthdayPartyLead,
              as: "lead",
              attributes: [],
              where: whereLead,
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [activeStartDate, activeEndDate] }
      },
      raw: true,
    });

    const paymentsLastYear = await BirthdayPartyPayment.findAll({
      attributes: [[fn("SUM", col("BirthdayPartyPayment.amount")), "total"]],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: BirthdayPartyLead,
              as: "lead",
              attributes: [],
              where: whereLead,
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: {
          [Op.between]: [activeLastYearStartDate, activeLastYearEndDate]
        }
      },
      raw: true,
    });

    const revenueThisYear = paymentsThisYear[0]?.total || 0;
    const revenueLastYear = paymentsLastYear[0]?.total || 0;

    // ✅ Source Breakdown (Marketing)
    const sourceBreakdown = await BirthdayPartyLead.findAll({
      attributes: ["source", [fn("COUNT", col("source")), "count"]],
      where: {
        [Op.and]: [
          whereLead,
          { createdAt: { [Op.between]: [activeStartDate, activeEndDate] } }
        ],
        source: { [Op.ne]: null },
      },
      group: ["source"],
      raw: true
    });

    // ✅ Top Agents
    const topAgents = await BirthdayPartyLead.findAll({
      where: {
        [Op.and]: [
          whereLead,
          { createdAt: { [Op.between]: [activeStartDate, activeEndDate] } }
        ],
      }, // ✅ filter by same createdBy logic
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
    const topAgentsLastYear = await BirthdayPartyLead.findAll({
      where: buildLeadWhere(activeLastYearStartDate, activeLastYearEndDate),
      attributes: ["createdBy", [fn("COUNT", col("createdBy")), "leadCount"]],
      include: [
        {
          model: Admin,
          as: "creator",
          attributes: ["id", "firstName", "lastName", "profile"]
        }
      ],
      group: ["createdBy", "creator.id"],
      order: [[literal("leadCount"), "DESC"]],
    });

    // 🧠 Generate all 12 months (Jan → Dec)
    const allMonths = Array.from({ length: 12 }, (_, i) => ({
      month: moment().month(i).format("MMMM"),
      students: 0,
      bookings: 0,
    }));
    // ✅ One-to-One Students (monthly trend — show all months)
    // Example for BirthdayPartyBooking monthly trend
    const monthlyStudentsRaw = await BirthdayPartyBooking.findAll({
      attributes: [
        [fn("DATE_FORMAT", col("BirthdayPartyBooking.createdAt"), "%M"), "month"],
        [fn("COUNT", col("BirthdayPartyBooking.id")), "bookings"],
        [fn("COUNT", fn("DISTINCT", col("students.id"))), "students"],
      ],
      include: [
        { model: BirthdayPartyStudent, as: "students", attributes: [], required: true },
        { model: BirthdayPartyLead, as: "lead", attributes: [], where: whereLead, required: true },
      ],
      where: {
        status: { [Op.in]: ["pending", "active"] },
        createdAt: { [Op.between]: [activeStartDate, activeEndDate] }, // ✅ Use dynamic filter
      },
      group: [fn("MONTH", col("BirthdayPartyBooking.createdAt"))],
      order: [[fn("MONTH", col("BirthdayPartyBooking.createdAt")), "ASC"]],
      raw: true,
    });

    const lastYearMonthlyStudentsRaw = await BirthdayPartyBooking.findAll({
      attributes: [
        [fn("DATE_FORMAT", col("BirthdayPartyBooking.createdAt"), "%M"), "month"],
        [fn("COUNT", col("BirthdayPartyBooking.id")), "bookings"],
        [fn("COUNT", fn("DISTINCT", col("students.id"))), "students"],
      ],
      include: [
        { model: BirthdayPartyStudent, as: "students", attributes: [], required: true },
        {
          model: BirthdayPartyLead,
          as: "lead",
          attributes: [],
          where: whereLead,
          required: true
        }
      ],
      where: {
        status: { [Op.in]: ["pending", "active"] },
        createdAt: { [Op.between]: [activeLastYearStartDate, activeLastYearEndDate] }
      },
      group: [fn("MONTH", col("BirthdayPartyBooking.createdAt"))],
      order: [[fn("MONTH", col("BirthdayPartyBooking.createdAt")), "ASC"]],
      raw: true
    });

    const lastYearMonthlyStudents = allMonths.map((m) => {
      const found = lastYearMonthlyStudentsRaw.find(
        (r) => r.month === m.month
      );

      return {
        month: m.month,
        students: found ? parseInt(found.students, 10) : 0,
        bookings: found ? parseInt(found.bookings, 10) : 0
      };
    });
    const lastYearMarketChannelRaw = await BirthdayPartyLead.findAll({
      attributes: ["source", [fn("COUNT", col("source")), "count"]],
      where: buildLeadWhere(activeLastYearStartDate, activeLastYearEndDate),
      group: ["source"],
      raw: true
    });

    const lastYearTotalSources = lastYearMarketChannelRaw.reduce(
      (sum, s) => sum + parseInt(s.count, 10),
      0
    );
    const lastYearSourceBreakdown = lastYearMarketChannelRaw.map(s => ({
      name: s.source,
      count: parseInt(s.count, 10),
      percentage: 0
    }))

    const lastYearMarketChannelPerformance = lastYearMarketChannelRaw.map((s) => {
      const count = parseInt(s.count, 10);
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
        students: found ? parseInt(found.students, 10) : 0,
        bookings: found ? parseInt(found.bookings, 10) : 0,
      };
    });

    // ✅ Package Breakdown (filtered by lead.createdBy)
    const packageBreakdown = await BirthdayPartyLead.findAll({
      attributes: [
        ["packageInterest", "packageName"], // e.g., Gold / Silver / 
        [fn("COUNT", col("packageInterest")), "count"],
      ],
      where: {
        [Op.and]: [
          whereLead,
          { createdAt: { [Op.between]: [activeStartDate, activeEndDate] } }
        ],
        packageInterest: { [Op.in]: ["Gold", "Silver"] },
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
    const renewalBreakdownRaw = await BirthdayPartyBooking.findAll({
      where: {
        createdAt: {
          [Op.between]: [
            moment().startOf("year").toDate(),
            moment().endOf("year").toDate()
          ]
        }
      },
      attributes: [
        [col("lead.packageInterest"), "packageName"], // join with lead’s package
        [fn("COUNT", col("BirthdayPartyBooking.id")), "count"],
      ],
      include: [
        {
          model: BirthdayPartyLead,
          as: "lead", // 👈 must match association alias in BirthdayPartyBooking model
          attributes: [],
          where: {
            packageInterest: { [Op.in]: ["Gold", "Silver"] },
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
    const renewalBreakdown = ["Gold", "Silver"].map((pkgName) => {
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
    // Example: revenue for current filter
    const revenueByPackageRaw = await BirthdayPartyPayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("BirthdayPartyPayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: BirthdayPartyLead,
              as: "lead",
              attributes: [],
              where: {
                packageInterest: { [Op.in]: ["Gold", "Silver"] }, [Op.and]: [
                  whereLead,
                  { createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] } }
                ]
              },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] }, // ✅ Apply dynamic filterType
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    // ✅ Revenue by Package (Last Month)
    const revenueByPackageLastMonth = await BirthdayPartyPayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("BirthdayPartyPayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: BirthdayPartyLead,
              as: "lead",
              attributes: [],
              where: {
                packageInterest: { [Op.in]: ["Gold", "Silver"] },
              },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] },
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    const revenueByPackageThisYearRaw = await BirthdayPartyPayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("BirthdayPartyPayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: BirthdayPartyLead,
              as: "lead",
              attributes: [],
              where: {
                packageInterest: { [Op.in]: ["Gold", "Silver"] },
                ...whereLead
              },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.between]: [activeStartDate, activeEndDate] }
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    const revenueByPackageLastYearRaw = await BirthdayPartyPayment.findAll({
      attributes: [
        [col("booking->lead.packageInterest"), "packageName"],
        [fn("SUM", col("BirthdayPartyPayment.amount")), "totalRevenue"],
      ],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: BirthdayPartyLead,
              as: "lead",
              attributes: [],
              where: {
                packageInterest: { [Op.in]: ["Gold", "Silver"] },
                ...whereLead
              },
              required: true,
            },
          ],
          required: true,
        },
      ],
      where: {
        createdAt: {
          [Op.between]: [activeLastYearStartDate, activeLastYearEndDate]
        }
      },
      group: ["booking->lead.packageInterest"],
      raw: true,
    });

    // 🧮 Combine and calculate growth %
    const revenueByPackage = ["Gold", "Silver"].map(pkgName => {
      const thisYear = revenueByPackageThisYearRaw.find(
        r => r.packageName === pkgName
      );
      const lastYear = revenueByPackageLastYearRaw.find(
        r => r.packageName === pkgName
      );

      const currentRevenue = thisYear ? Number(thisYear.totalRevenue) : 0;
      const lastRevenue = lastYear ? Number(lastYear.totalRevenue) : 0;

      const revenueGrowth =
        lastRevenue > 0
          ? Number((((currentRevenue - lastRevenue) / lastRevenue) * 100).toFixed(2))
          : 0;

      return {
        name: pkgName,
        currentRevenue,
        lastRevenue,
        revenueGrowth,
      };
    });

    // ✅ Marketing Channel Performance
    const marketChannelRaw = await BirthdayPartyLead.findAll({
      attributes: ["source", [fn("COUNT", col("source")), "count"]],
      where: {
        [Op.and]: [
          whereLead,
          { createdAt: { [Op.between]: [activeStartDate, activeEndDate] } }
        ],
        source: { [Op.ne]: null }
      },
      group: ["source"],
      raw: true
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
    const partyBookingRaw = await BirthdayPartyStudent.findAll({
      attributes: [
        "age",
        "gender",
        [fn("COUNT", col("BirthdayPartyStudent.id")), "count"],
      ],
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          attributes: [],
          include: [
            {
              model: BirthdayPartyLead,
              as: "lead",
              attributes: [],
              where: {
                [Op.and]: [
                  whereLead,
                  { createdAt: { [Op.between]: [startOfThisYear, endOfThisYear] } }
                ]
              }, // ✅ filter by lead.createdBy (scope)
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
    // ==========================================
    // PACKAGE BACKGROUND (Growth + Revenue)
    // ==========================================

    // 1️⃣ Growth = lead count (packageBreakdown)
    const growth = ["Gold", "Silver"].map(pkgName => {
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

    const revenue = ["Gold", "Silver"].map(pkgName => {
      const found = revenueByPackage.find(
        r => r.name?.toLowerCase() === pkgName.toLowerCase()
      );

      const count = found?.currentRevenue ?? 0;
      const percentage =
        totalRevenue > 0
          ? Number(((count / totalRevenue) * 100).toFixed(2))
          : 0;

      return { name: pkgName, count, percentage };
    });

    // 3️⃣ Final output
    const packageBackground = [
      { growth },
      { revenue }
    ];
    // ===============================
    // PACKAGE REVENUE (SUMMARY - YEAR WISE)
    // ===============================

    const revenueGoldThisYear =
      revenueByPackage.find(p => p.name === "Gold")?.currentRevenue || 0;

    const revenueGoldLastYear =
      revenueByPackage.find(p => p.name === "Gold")?.lastRevenue || 0;

    const revenueSilverThisYear =
      revenueByPackage.find(p => p.name === "Silver")?.currentRevenue || 0;

    const revenueSilverLastYear =
      revenueByPackage.find(p => p.name === "Silver")?.lastRevenue || 0;

    const getAverageBirthdayChildAge = async (startDate, endDate, leadFilter) => {
      const avgAgeRaw = await BirthdayPartyStudent.findOne({
        attributes: [[fn("AVG", col("BirthdayPartyStudent.age")), "avgAge"]],
        include: [
          {
            model: BirthdayPartyBooking,
            as: "booking",
            attributes: [],
            include: [
              {
                model: BirthdayPartyLead,
                as: "lead",
                attributes: [],
                where: leadFilter,
                required: true
              }
            ],
            required: true
          }
        ],
        where: {
          createdAt: { [Op.between]: [startDate, endDate] }
        },
        raw: true
      });

      return avgAgeRaw?.avgAge ? Math.round(parseFloat(avgAgeRaw.avgAge)) : 0;
    };
    const averageBirthdayChildAge = await getAverageBirthdayChildAge(
      moment().startOf("year").toDate(),
      moment().endOf("year").toDate(),
      whereLead
    );

    const averageBirthdayChildAgeLastYear = await getAverageBirthdayChildAge(
      activeLastYearStartDate,
      activeLastYearEndDate,
      whereLead
    );

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
          thisYear: `${conversionThisYear}%`,
          lastYear: `${conversionLastYear}%`,
        },
        revenueGenerated: {
          thisYear: revenueThisYear,
          lastYear: revenueLastYear,
        },
        packageRevenue: {
          gold: {
            thisYear: revenueGoldThisYear,
            lastYear: revenueGoldLastYear,
          },
          silver: {
            thisYear: revenueSilverThisYear,
            lastYear: revenueSilverLastYear,
          },
        }
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
          revenueByPackage: revenueByPackage || [],
          averageBirthdayChild: {
            value: averageBirthdayChildAge,
            label: `${averageBirthdayChildAge} Years`
          },

        },
        // lastYear: {
        //   year: lastYear,

        //   // monthlyStudents: defaultMonthlyStudents(),
        //   monthlyStudents: useOrDefault(
        //     lastYearMonthlyStudents,
        //     defaultMonthlyStudents()
        //   ),
        //   marketChannelPerformance: useOrDefault(
        //     lastYearMarketChannelPerformance,
        //     defaultCountBreakdown(["Flyer", "Online", "Referral"])
        //   ),
        //   sourceBreakdown: useOrDefault(
        //     lastYearSourceBreakdown,
        //     defaultCountBreakdown(["Flyer", "Online", "Referral"])
        //   ),
        //   topAgents: [
        //     {
        //       createdBy: null,
        //       leadCount: 0,
        //       creator: {}
        //     }
        //   ],

        //   partyBooking: [
        //     {
        //       byAge: [],
        //       byGender: defaultCountBreakdown(["male", "female", "other"]),
        //       byTotal: [
        //         {
        //           name: "Total",
        //           count: 0,
        //           percentage: 100
        //         }
        //       ]
        //     }
        //   ],

        //   packageBackground: [
        //     {
        //       growth: defaultCountBreakdown(["Gold", "Silver"])
        //     },
        //     {
        //       revenue: defaultCountBreakdown(["Gold", "Silver"])
        //     }
        //   ],

        //   renewalBreakdown: defaultCountBreakdown(["Gold", "Silver"]),

        //   packageBreakdown: defaultCountBreakdown(["Gold", "Silver"]),

        //   revenueByPackage: defaultRevenueByPackage(["Gold", "Silver"]),
        //   averageBirthdayChild: {
        //     value: averageBirthdayChildAgeLastYear,
        //     label: `${averageBirthdayChildAgeLastYear} Years`
        //   },
        // }

      }
    };
  } catch (error) {
    console.error("❌ Error fetching One-to-One analytics:", error);
    return { status: false, message: error.message };
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
    const leadsWithBooking = await BirthdayPartyLead.findAll({
      where: { id: leadIds },
      include: [
        {
          model: BirthdayPartyBooking,
          as: "booking",
          required: true,
          include: [
            {
              model: BirthdayPartyStudent,
              as: "students",
              include: [{ model: BirthdayPartyParent, as: "parentDetails" }],
            },
            { model: BirthdayPartyPayment, as: "payment" },
          ],
        },
      ],
    });

    console.log("📦 Leads with booking fetched:", leadsWithBooking.length);

    if (!leadsWithBooking.length) {
      return { status: false, message: "No matching leads found with active bookings." };
    }

    // Email configuration
    const emailConfigResult = await getEmailConfig("admin", "birthday-party-booking-sendEmail");
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
          .replace(/{{time}}/g, bookingTime)
          .replace(/{{status}}/g, status)
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

exports.cancelBirthdayPartyLeadAndBooking = async (leadId, superAdminId, adminId) => {
  const t = await sequelize.transaction();

  try {

    // Find lead with booking
    const lead = await BirthdayPartyLead.findOne({
      where: {
        id: leadId,
        [Op.or]: [{ createdBy: adminId }, { createdBy: superAdminId }]
      },
      include: [
        {
          model: BirthdayPartyBooking,
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

exports.renewBirthdayPartyLeadAndBooking = async (leadId, superAdminId, adminId) => {
  const t = await sequelize.transaction();

  try {
    const lead = await BirthdayPartyLead.findOne({
      where: {
        id: leadId,
        [Op.or]: [{ createdBy: adminId }, { createdBy: superAdminId }]
      },
      include: [{ model: BirthdayPartyBooking, as: "booking" }],
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

// exports.getBirthdayPartyBookingById = async (bookingId, superAdminId, adminId) => {
//   try {
//     if (!bookingId) {
//       return { status: false, message: "Booking ID is required." };
//     }

//     if (!adminId || isNaN(Number(adminId))) {
//       return { status: false, message: "Invalid admin ID." };
//     }

//     // 1️⃣ Find booking using bookingId
//     const booking = await BirthdayPartyBooking.findOne({
//       where: { id: bookingId },
//       attributes: ["id", "leadId"],
//     });

//     if (!booking) {
//       return {
//         status: false,
//         message: "Birthday Party booking not found.",
//       };
//     }

//     if (!booking.leadId) {
//       return {
//         status: false,
//         message: "Lead ID not found for this Birthday Party booking.",
//       };
//     }

//     // 2️⃣ Reuse existing lead service (single source of truth)
//     return await exports.getBirthdayPartyLeadsById(
//       booking.leadId,
//       adminId,
//       superAdminId
//     );

//   } catch (error) {
//     console.error("❌ Error fetching birthday party booking by ID:", error);
//     return { status: false, message: error.message };
//   }
// };
