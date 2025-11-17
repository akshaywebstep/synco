const {
  Lead,
  Venue,
  Comment,
  Admin,
  ClassSchedule,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  PaymentGroup,
  TermGroup,
  Term,
  PaymentPlan,
  PaymentGroupHasPlan,
} = require("../../../models");
const axios = require("axios");
const { Op } = require("sequelize");
const { sequelize } = require("../../../models");
const DEBUG = process.env.DEBUG === "true";

// -------------------- Helpers -------------------- //

// Haversine formula to calculate distance (km) between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function getCoordinatesFromPostcode(postcode) {
  if (!postcode || typeof postcode !== "string" || postcode.trim().length < 5) {
    console.warn("⚠️ Skipping postcode lookup: invalid postcode", postcode);
    return null;
  }

  try {
    const res = await axios.get(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(
        postcode.trim()
      )}`
    );

    if (res.data.status === 200 && res.data.result) {
      return {
        latitude: res.data.result.latitude,
        longitude: res.data.result.longitude,
      };
    } else {
      console.warn("⚠️ Postcode not found:", postcode);
    }
  } catch (err) {
    console.error(
      "❌ Postcode lookup error:",
      err.response?.data?.error || err.message
    );
  }

  return null;
}

// -------------------- Lead Services -------------------- //

exports.addCommentForLead = async ({
  commentBy = null,
  comment,
  commentType = "lead", // default as per model
}) => {
  const t = await sequelize.transaction();
  try {
    if (DEBUG) {
      ("🔍 Starting addComment service...");
    }

    // 🔹 1. (Optional) Validate Admin/User who made the comment
    let admin = null;
    if (commentBy) {
      admin = await Admin.findByPk(commentBy, { transaction: t });
      if (!admin) {
        await t.rollback();
        if (DEBUG) {
          "❌ Admin not found:", commentBy;
        }
        return { status: false, message: "❌ Admin not found." };
      }
      if (DEBUG) {
        "✅ Admin validated:", admin.id;
      }
    }

    // 🔹 2. Create comment record
    const newComment = await Comment.create(
      {
        commentBy,
        comment,
        commentType,
      },
      { transaction: t }
    );
    if (DEBUG) {
      "✅ Comment created:", newComment.id;
    }

    await t.commit();
    if (DEBUG) {
      ("🎉 Transaction committed successfully");
    }
    return {
      status: true,
      message: "✅ Comment added successfully.",
      data: {
        comment: newComment,
        admin,
      },
    };
  } catch (error) {
    await t.rollback();
    if (DEBUG) {
      "❌ addCommentForLead Error:", error;
    }
    return { status: false, message: error.message };
  }
};

exports.listCommentsForLead = async ({ commentType = "lead" }) => {
  try {
    if (DEBUG) {
      ("🔍 Starting listComments service...");
    }
    const comments = await Comment.findAll({
      where: { commentType },
      include: [
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

      order: [["createdAt", "ASC"]],
    });

    if (DEBUG) {
      `✅ Found ${comments.length} comments`;
    }
    return {
      status: true,
      message: "✅ Comments fetched successfully",
      data: comments,
    };
  } catch (error) {
    if (DEBUG) {
      "❌ listComments Error:", error;
    }
    return { status: false, message: error.message };
  }
};

// CREATE Lead
exports.createLead = async (payload) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      postcode,
      childAge,
      status,
      assignedAgentId,
      createdBy,
    } = payload;

    if (!firstName || !lastName)
      return {
        status: false,
        message: "First name and last name are required",
      };
    if (!email) return { status: false, message: "Email is required" };
    if (!childAge || isNaN(childAge))
      return { status: false, message: "Child age must be a valid number" };

    const lead = await Lead.create({
      firstName,
      lastName,
      email,
      phone,
      postcode,
      childAge,
      status: status || "others",
      assignedAgentId,
      createdBy,
    });

    return { status: true, message: "Lead created successfully", data: lead };
  } catch (error) {
    console.error("❌ createLead Error:", error.message);
    return { status: false, message: error.message };
  }
};

// GET All Leads with nearestVenues and allVenues

// exports.getAllLeads = async (filters = {}) => {
//   try {
//     const allLeads = await Lead.findAll({
//       order: [["createdAt", "DESC"]],
//       include: [
//         {
//           model: Admin,
//           as: "assignedAgent",
//           attributes: ["id", "firstName", "lastName", "email", "roleId"],
//         },
//         {
//           model: Booking,
//           as: "bookings",
//           include: [
//             { model: Venue, as: "venue" },
//             { model: ClassSchedule, as: "classSchedule" },
//             {
//               model: BookingStudentMeta,
//               as: "students",
//               attributes: [
//                 "studentFirstName",
//                 "studentLastName",
//                 "dateOfBirth",
//                 "age",
//                 "gender",
//                 "medicalInformation",
//               ],
//               include: [
//                 {
//                   model: BookingParentMeta,
//                   as: "parents",
//                   attributes: [
//                     "parentFirstName",
//                     "parentLastName",
//                     "parentEmail",
//                     "parentPhoneNumber",
//                     "relationToChild",
//                     "howDidYouHear",
//                   ],
//                 },
//                 {
//                   model: BookingEmergencyMeta,
//                   as: "emergencyContacts",
//                   attributes: [
//                     "emergencyFirstName",
//                     "emergencyLastName",
//                     "emergencyPhoneNumber",
//                     "emergencyRelation",
//                   ],
//                 },
//               ],
//             },
//           ],
//         },
//       ],
//     });

//     const totalLeads = allLeads.length;

//     // ✅ Count "new" leads (still using lead.status)
//     const newLeadsCount = allLeads.filter(
//       (lead) => !lead.bookings || lead.bookings.length === 0
//     ).length;

//     // ✅ Count leads that have at least one "free" booking
//     const leadsToTrialsCount = allLeads.filter(
//       (lead) => (lead.bookings || []).some((b) => b.bookingType === "free")
//     ).length;

//     // ✅ Count leads that have at least one "paid" booking
//     const leadsToSalesCount = allLeads.filter(
//       (lead) => (lead.bookings || []).some((b) => b.bookingType === "paid")
//     ).length;

//     const analytics = {
//       totalLeads: {
//         count: totalLeads,
//         conversion: totalLeads ? "100%" : "0%",
//       },
//       newLeads: {
//         count: newLeadsCount,
//         conversion: totalLeads
//           ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%"
//           : "0.00%",
//       },
//       leadsToTrials: {
//         count: leadsToTrialsCount,
//         conversion: totalLeads
//           ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%"
//           : "0.00%",
//       },
//       leadsToSales: {
//         count: leadsToSalesCount,
//         conversion: totalLeads
//           ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%"
//           : "0.00%",
//       },
//     };

//     // Filters
//     let filteredLeads = allLeads;
//     if (filters.fromDate || filters.toDate) {
//       const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
//       const toDate = filters.toDate ? new Date(filters.toDate) : null;
//       if (toDate) toDate.setHours(23, 59, 59, 999);

//       filteredLeads = filteredLeads.filter((lead) => {
//         const createdAt = new Date(lead.createdAt);
//         return (!fromDate || createdAt >= fromDate) && (!toDate || createdAt <= toDate);
//       });
//     }
//     if (filters.name) {
//       const nameLower = filters.name.toLowerCase().trim();

//       filteredLeads = filteredLeads.filter((l) => {
//         const firstName = (l.firstName || "").toLowerCase();
//         const lastName = (l.lastName || "").toLowerCase();
//         const fullName = `${firstName} ${lastName}`.trim();

//         return (
//           firstName.includes(nameLower) ||
//           lastName.includes(nameLower) ||
//           fullName.includes(nameLower)
//         );
//       });
//     }

//     if (filters.status) {
//       filteredLeads = filteredLeads.filter((l) => l.status === filters.status);
//     }

//     let allVenuesList = await Venue.findAll();
//     // ✅ Venue filter
//     if (filters.venueName) {
//       const nameLower = filters.venueName.toLowerCase();

//       filteredLeads = filteredLeads.filter((lead) => {
//         // Keep only bookings that match venue
//         lead.bookings = (lead.bookings || []).filter((booking) =>
//           booking.venue?.name?.toLowerCase().includes(nameLower)
//         );
//         return lead.bookings.length > 0;
//       });
//     }

//     // ✅ Student filter
//     if (filters.studentName) {
//       const studentLower = filters.studentName.toLowerCase();

//       filteredLeads = filteredLeads.filter((lead) => {
//         // Keep only bookings where at least one student matches
//         lead.bookings = (lead.bookings || []).filter((booking) =>
//           (booking.students || []).some((student) => {
//             const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
//             return fullName.includes(studentLower);
//           })
//         );

//         // Also trim students inside each booking to only those matching
//         lead.bookings = lead.bookings.map((booking) => ({
//           ...booking,
//           students: (booking.students || []).filter((student) => {
//             const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
//             return fullName.includes(studentLower);
//           }),
//         }));

//         return lead.bookings.length > 0;
//       });
//     }

//     const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

//     // Format each lead
//     const formattedLeads = await Promise.all(
//       filteredLeads.map(async (lead) => {
//         const bookingData = (lead.bookings || []).map((booking) => {
//           const students = (booking.students || []).map((s) => ({
//             studentFirstName: s.studentFirstName,
//             studentLastName: s.studentLastName,
//             dateOfBirth: s.dateOfBirth,
//             age: s.age,
//             gender: s.gender,
//             medicalInformation: s.medicalInformation,
//           }));

//           const parents = (booking.students || []).flatMap((s) =>
//             (s.parents || []).map((p) => ({
//               parentFirstName: p.parentFirstName,
//               parentLastName: p.parentLastName,
//               parentEmail: p.parentEmail,
//               parentPhoneNumber: p.parentPhoneNumber,
//               relationToChild: p.relationToChild,
//               howDidYouHear: p.howDidYouHear,
//             }))
//           );

//           const emergencyContacts = (booking.students || []).flatMap((s) =>
//             (s.emergencyContacts || []).map((e) => ({
//               emergencyFirstName: e.emergencyFirstName,
//               emergencyLastName: e.emergencyLastName,
//               emergencyPhoneNumber: e.emergencyPhoneNumber,
//               emergencyRelation: e.emergencyRelation,
//             }))
//           );

//           const { students: _, ...bookingWithoutStudents } = booking.dataValues;
//           return { ...bookingWithoutStudents, students, parents, emergencyContacts };
//         });

//         const { bookings, ...leadWithoutBookings } = lead.dataValues;

//         // Nearest venues
//         let nearestVenues = [];
//         if (lead.postcode && allVenuesList.length > 0) {
//           const coords = await getCoordinatesFromPostcode(lead.postcode);
//           if (coords) {
//             nearestVenues = await Promise.all(
//               allVenuesList
//                 .map((v) => ({
//                   ...v.dataValues,
//                   distance: calculateDistance(coords.latitude, coords.longitude, v.latitude, v.longitude),
//                 }))
//                 .sort((a, b) => a.distance - b.distance)
//                 .slice(0, 5)
//                 .map(async (venue) => {
//                   const classSchedules = await ClassSchedule.findAll({ where: { venueId: venue.id } });
//                   return { ...venue, classSchedules: classSchedules.map((cs) => cs.dataValues) };
//                 })
//             );
//           }
//         }

//         return {
//           ...leadWithoutBookings,
//           bookingData,
//           nearestVenues,
//         };
//       })
//     );

//     // ✅ Return formatted leads
//     const leadsWithNearestVenue = formattedLeads.filter((lead) => lead.nearestVenues.length > 0);

//     return {
//       status: true,
//       message: "Leads with nearest venues retrieved",
//       data: leadsWithNearestVenue,
//       // allVenues,
//       analytics,
//     };
//   } catch (error) {
//     console.error("❌ getAllLeads Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };
exports.getAllForFacebookLeads = async (adminId, superAdminId, filters = {}) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid admin ID found for this request.",
        data: [],
      };
    }

    // ✅ Build WHERE conditions for super admin vs admin
    const whereLead = { status: "facebook" };
    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      allowedAdminIds = adminIds;
      whereLead.createdBy = { [Op.in]: adminIds };
    } else if (superAdminId && adminId) {
      // 🟢 Admin → fetch own + super admin’s leads
      allowedAdminIds = [adminId, superAdminId];
      whereLead.createdBy = { [Op.in]: allowedAdminIds };
    } else {
      // 🟢 Fallback
      allowedAdminIds = [adminId];
      whereLead.createdBy = adminId;
    }

    // ✅ Fetch all leads
    const allLeads = await Lead.findAll({
      order: [["createdAt", "ASC"]],
      where: whereLead,
      include: [
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName", "email", "roleId"],
        },
        {
          model: Booking,
          as: "bookings",
          include: [
            { model: Venue, as: "venue" },
            { model: ClassSchedule, as: "classSchedule" },
            {
              model: BookingStudentMeta,
              as: "students",
              attributes: [
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "age",
                "gender",
                "medicalInformation",
              ],
              include: [
                {
                  model: BookingParentMeta,
                  as: "parents",
                  attributes: [
                    "parentFirstName",
                    "parentLastName",
                    "parentEmail",
                    "parentPhoneNumber",
                    "relationToChild",
                    "howDidYouHear",
                  ],
                },
                {
                  model: BookingEmergencyMeta,
                  as: "emergencyContacts",
                  attributes: [
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // ✅ Analytics
    const totalLeads = allLeads.length;
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;

    const leadsToTrialsCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;

    const leadsToSalesCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "paid")
    ).length;

    const analytics = {
      totalLeads: {
        count: totalLeads,
        conversion: totalLeads ? "100%" : "0%",
      },
      newLeads: {
        count: newLeadsCount,
        conversion: totalLeads
          ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToTrials: {
        count: leadsToTrialsCount,
        conversion: totalLeads
          ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToSales: {
        count: leadsToSalesCount,
        conversion: totalLeads
          ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
    };

    // ✅ Filters
    let filteredLeads = allLeads;

    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (
          (!fromDate || createdAt >= fromDate) &&
          (!toDate || createdAt <= toDate)
        );
      });
    }

    if (filters.name) {
      const nameLower = filters.name.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((l) => {
        const firstName = (l.firstName || "").toLowerCase();
        const lastName = (l.lastName || "").toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        return (
          firstName.includes(nameLower) ||
          lastName.includes(nameLower) ||
          fullName.includes(nameLower)
        );
      });
    }

    if (filters.status) {
      const statusFilter = filters.status.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((lead) =>
        (lead.bookings || []).some((booking) => {
          const bookingStatus = (booking.status || "").toLowerCase();
          return statusFilter === "request_to_cancel"
            ? bookingStatus === "request_to_cancel" ||
            bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    const allVenuesList = await Venue.findAll({
      where: { createdBy: { [Op.in]: allowedAdminIds } }
    });

    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          booking.venue?.name?.toLowerCase().includes(nameLower)
        );
        return lead.bookings.length > 0;
      });
    }

    if (filters.studentName) {
      const studentLower = filters.studentName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );
        return lead.bookings.length > 0;
      });
    }

    // ✅ Format leads
    const formattedLeads = await Promise.all(
      filteredLeads.map(async (lead) => {
        const bookingData = (lead.bookings || []).map((booking) => {
          const students = (booking.students || []).map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          }));

          const parents = (booking.students || []).flatMap((s) =>
            (s.parents || []).map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            }))
          );

          const emergencyContacts = (booking.students || []).flatMap((s) =>
            (s.emergencyContacts || []).map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
          );

          const { students: _, ...bookingWithoutStudents } = booking.dataValues;
          return {
            ...bookingWithoutStudents,
            students,
            parents,
            emergencyContacts,
          };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;
        let nearestVenues = [];

        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);

          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: Number(
                    calculateDistance(
                      coords.latitude,
                      coords.longitude,
                      v.latitude,
                      v.longitude
                    ).toFixed(2)
                  ),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {

                  // Debug: show the id you're looking for
                  console.log("Searching termGroupId:", venue.termGroupId[0]);

                  // Get all terms that use this termGroupId
                  const allTerms = await Term.findAll({
                    where: { createdBy: { [Op.in]: allowedAdminIds } }
                  });

                  console.log("Terms found:", allTerms.map(t => t.dataValues));

                  const classSchedules = await ClassSchedule.findAll({
                    where: { venueId: venue.id }

                  });
                  // 1️⃣ Get the Payment Group for this venue
                  const paymentGroup = await PaymentGroup.findOne({
                    where: { id: venue.paymentGroupId }
                  });

                  // 2️⃣ Get the Plan IDs from the pivot table
                  const groupPlanLinks = await PaymentGroupHasPlan.findAll({
                    where: { payment_group_id: venue.paymentGroupId },
                    attributes: ['payment_plan_id'] // only return needed column
                  });

                  // 3️⃣ Extract the plan IDs
                  const planIds = groupPlanLinks.map(link => link.payment_plan_id);

                  // 4️⃣ Fetch only those payment plans
                  const paymentPlans = await PaymentPlan.findAll({
                    where: { id: planIds }
                  });
                  return {
                    ...venue,
                    classSchedules: classSchedules.map((cs) => cs.dataValues),
                    terms: allTerms.map(t => t.dataValues),   // return terms here
                    // Attach payment info
                    paymentGroup: paymentGroup ? paymentGroup.dataValues : null,

                    paymentPlans: paymentPlans.map(pp => pp.dataValues),
                  };
                })
            );
          }
        }

        return {
          ...leadWithoutBookings,
          bookingData,
          nearestVenues,
        };

      })
    );

    return {
      status: true,
      message: "Facebook leads retrieved successfully",
      data: formattedLeads,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllForFacebookLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getAllReferallLeads = async (adminId, superAdminId, filters = {}) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid admin ID found for this request.",
        data: [],
      };
    }

    // ✅ Build WHERE conditions for super admin vs admin
    const whereLead = { status: "referall" };
    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      allowedAdminIds = adminIds;
      whereLead.createdBy = { [Op.in]: adminIds };
    } else if (superAdminId && adminId) {
      // 🟢 Admin → fetch own + super admin’s leads
      allowedAdminIds = [adminId, superAdminId];
      whereLead.createdBy = { [Op.in]: allowedAdminIds };
    } else {
      // 🟢 Fallback
      allowedAdminIds = [adminId];
      whereLead.createdBy = adminId;
    }

    // ✅ Fetch all leads
    const allLeads = await Lead.findAll({
      order: [["createdAt", "ASC"]],
      where: whereLead,
      include: [
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName", "email", "roleId"],
        },
        {
          model: Booking,
          as: "bookings",
          include: [
            { model: Venue, as: "venue" },
            { model: ClassSchedule, as: "classSchedule" },
            {
              model: BookingStudentMeta,
              as: "students",
              attributes: [
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "age",
                "gender",
                "medicalInformation",
              ],
              include: [
                {
                  model: BookingParentMeta,
                  as: "parents",
                  attributes: [
                    "parentFirstName",
                    "parentLastName",
                    "parentEmail",
                    "parentPhoneNumber",
                    "relationToChild",
                    "howDidYouHear",
                  ],
                },
                {
                  model: BookingEmergencyMeta,
                  as: "emergencyContacts",
                  attributes: [
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // ✅ Calculate analytics
    const totalLeads = allLeads.length;
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;
    const leadsToTrialsCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;
    const leadsToSalesCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "paid")
    ).length;

    const analytics = {
      totalLeads: {
        count: totalLeads,
        conversion: totalLeads ? "100%" : "0%",
      },
      newLeads: {
        count: newLeadsCount,
        conversion: totalLeads
          ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToTrials: {
        count: leadsToTrialsCount,
        conversion: totalLeads
          ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToSales: {
        count: leadsToSalesCount,
        conversion: totalLeads
          ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
    };

    // ✅ Apply filters
    let filteredLeads = allLeads;
    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (
          (!fromDate || createdAt >= fromDate) &&
          (!toDate || createdAt <= toDate)
        );
      });
    }

    if (filters.name) {
      const nameLower = filters.name.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((l) => {
        const firstName = (l.firstName || "").toLowerCase();
        const lastName = (l.lastName || "").toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        return (
          firstName.includes(nameLower) ||
          lastName.includes(nameLower) ||
          fullName.includes(nameLower)
        );
      });
    }

    if (filters.status) {
      const statusFilter = filters.status.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((lead) =>
        (lead.bookings || []).some((booking) => {
          const bookingStatus = (booking.status || "").toLowerCase();
          return statusFilter === "request_to_cancel"
            ? bookingStatus === "request_to_cancel" ||
            bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    const allVenuesList = await Venue.findAll({
      where: { createdBy: { [Op.in]: allowedAdminIds } }
    });

    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          booking.venue?.name?.toLowerCase().includes(nameLower)
        );
        return lead.bookings.length > 0;
      });
    }

    if (filters.studentName) {
      const studentLower = filters.studentName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );
        return lead.bookings.length > 0;
      });
    }

    // ✅ Format leads
    const formattedLeads = await Promise.all(
      filteredLeads.map(async (lead) => {
        const bookingData = (lead.bookings || []).map((booking) => {
          const students = (booking.students || []).map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          }));

          const parents = (booking.students || []).flatMap((s) =>
            (s.parents || []).map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            }))
          );

          const emergencyContacts = (booking.students || []).flatMap((s) =>
            (s.emergencyContacts || []).map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
          );

          const { students: _, ...bookingWithoutStudents } = booking.dataValues;
          return {
            ...bookingWithoutStudents,
            students,
            parents,
            emergencyContacts,
          };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;
        // -----------------------------------------
        // NEAREST VENUES CALCULATION
        // -----------------------------------------
        let nearestVenues = [];

        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);

          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: Number(
                    calculateDistance(
                      coords.latitude,
                      coords.longitude,
                      v.latitude,
                      v.longitude
                    ).toFixed(2)
                  ),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {

                  // Debug: show the id you're looking for
                  console.log("Searching termGroupId:", venue.termGroupId[0]);

                  // Get all terms that use this termGroupId
                  const allTerms = await Term.findAll({
                    where: { createdBy: { [Op.in]: allowedAdminIds } }
                  });

                  console.log("Terms found:", allTerms.map(t => t.dataValues));

                  const classSchedules = await ClassSchedule.findAll({
                    where: { venueId: venue.id }

                  });
                  // 1️⃣ Get the Payment Group for this venue
                  const paymentGroup = await PaymentGroup.findOne({
                    where: { id: venue.paymentGroupId }
                  });

                  // 2️⃣ Get the Plan IDs from the pivot table
                  const groupPlanLinks = await PaymentGroupHasPlan.findAll({
                    where: { payment_group_id: venue.paymentGroupId },
                    attributes: ['payment_plan_id'] // only return needed column
                  });

                  // 3️⃣ Extract the plan IDs
                  const planIds = groupPlanLinks.map(link => link.payment_plan_id);

                  // 4️⃣ Fetch only those payment plans
                  const paymentPlans = await PaymentPlan.findAll({
                    where: { id: planIds }
                  });
                  return {
                    ...venue,
                    classSchedules: classSchedules.map((cs) => cs.dataValues),
                    terms: allTerms.map(t => t.dataValues),   // return terms here
                    // Attach payment info
                    paymentGroup: paymentGroup ? paymentGroup.dataValues : null,

                    paymentPlans: paymentPlans.map(pp => pp.dataValues),
                  };
                })
            );
          }
        }

        return {
          ...leadWithoutBookings,
          bookingData,
          nearestVenues, // no venue-distance logic changed
        };
      })
    );

    return {
      status: true,
      message: "Referall leads retrieved successfully",
      data: formattedLeads,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllReferallLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getAllOthersLeads = async (adminId, superAdminId, filters = {}) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "Invalid admin ID.",
        data: [],
      };
    }

    // ✅ Build WHERE conditions for super admin vs admin
    const whereLead = { status: "others" };
    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      allowedAdminIds = adminIds;
      whereLead.createdBy = { [Op.in]: adminIds };
    } else if (superAdminId && adminId) {
      // 🟢 Admin → fetch own + super admin’s leads
      allowedAdminIds = [adminId, superAdminId];
      whereLead.createdBy = { [Op.in]: [adminId, superAdminId] };
    } else {
      // 🟢 Fallback
      allowedAdminIds = [adminId];
      whereLead.createdBy = adminId;
    }

    // ✅ Fetch all leads created by allowed admins
    const allLeads = await Lead.findAll({
      where: whereLead,
      order: [["createdAt", "ASC"]],
      include: [
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName", "email", "roleId"],
        },
        {
          model: Booking,
          as: "bookings",
          include: [
            { model: Venue, as: "venue" },

            { model: ClassSchedule, as: "classSchedule" },
            {
              model: BookingStudentMeta,
              as: "students",
              attributes: [
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "age",
                "gender",
                "medicalInformation",
              ],
              include: [
                {
                  model: BookingParentMeta,
                  as: "parents",
                  attributes: [
                    "parentFirstName",
                    "parentLastName",
                    "parentEmail",
                    "parentPhoneNumber",
                    "relationToChild",
                    "howDidYouHear",
                  ],
                },
                {
                  model: BookingEmergencyMeta,
                  as: "emergencyContacts",
                  attributes: [
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // ✅ Analytics calculations
    const totalLeads = allLeads.length;

    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;

    const leadsToTrialsCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;

    const leadsToSalesCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "paid")
    ).length;

    const analytics = {
      totalLeads: {
        count: totalLeads,
        conversion: totalLeads ? "100%" : "0%",
      },
      newLeads: {
        count: newLeadsCount,
        conversion: totalLeads
          ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToTrials: {
        count: leadsToTrialsCount,
        conversion: totalLeads
          ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToSales: {
        count: leadsToSalesCount,
        conversion: totalLeads
          ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
    };

    // ✅ Apply filters
    let filteredLeads = allLeads;

    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (
          (!fromDate || createdAt >= fromDate) &&
          (!toDate || createdAt <= toDate)
        );
      });
    }

    if (filters.name) {
      const nameLower = filters.name.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((l) => {
        const firstName = (l.firstName || "").toLowerCase();
        const lastName = (l.lastName || "").toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        return (
          firstName.includes(nameLower) ||
          lastName.includes(nameLower) ||
          fullName.includes(nameLower)
        );
      });
    }

    if (filters.status) {
      const statusFilter = filters.status.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((lead) =>
        (lead.bookings || []).some((booking) => {
          const bookingStatus = (booking.status || "").toLowerCase();
          return statusFilter === "request_to_cancel"
            ? bookingStatus === "request_to_cancel" ||
            bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    // ✅ Fetch only venues created by allowed admins
    let allVenuesList = await Venue.findAll({
      where: { createdBy: { [Op.in]: allowedAdminIds } },
    });

    // ✅ Venue filter
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          booking.venue?.name?.toLowerCase().includes(nameLower)
        );
        return lead.bookings.length > 0;
      });
    }

    // ✅ Student filter
    if (filters.studentName) {
      const studentLower = filters.studentName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          }),
        }));
        return lead.bookings.length > 0;
      });
    }

    // ✅ Format each lead
    const formattedLeads = await Promise.all(
      filteredLeads.map(async (lead) => {
        const bookingData = (lead.bookings || []).map((booking) => {
          const students = (booking.students || []).map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          }));

          const parents = (booking.students || []).flatMap((s) =>
            (s.parents || []).map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            }))
          );

          const emergencyContacts = (booking.students || []).flatMap((s) =>
            (s.emergencyContacts || []).map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
          );

          const { students: _, ...bookingWithoutStudents } = booking.dataValues;
          return {
            ...bookingWithoutStudents,
            students,
            parents,
            emergencyContacts,
          };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;

        // ✅ Nearby Venues (created by allowed admins)
        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);

          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: Number(
                    calculateDistance(
                      coords.latitude,
                      coords.longitude,
                      v.latitude,
                      v.longitude
                    ).toFixed(2)
                  ),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {

                  // Debug: show the id you're looking for
                  console.log("Searching termGroupId:", venue.termGroupId[0]);

                  // Get all terms that use this termGroupId
                  const allTerms = await Term.findAll({
                    where: { createdBy: { [Op.in]: allowedAdminIds } }
                  });

                  console.log("Terms found:", allTerms.map(t => t.dataValues));

                  const classSchedules = await ClassSchedule.findAll({
                    where: { venueId: venue.id }

                  });
                  // 1️⃣ Get the Payment Group for this venue
                  const paymentGroup = await PaymentGroup.findOne({
                    where: { id: venue.paymentGroupId }
                  });

                  // 2️⃣ Get the Plan IDs from the pivot table
                  const groupPlanLinks = await PaymentGroupHasPlan.findAll({
                    where: { payment_group_id: venue.paymentGroupId },
                    attributes: ['payment_plan_id'] // only return needed column
                  });

                  // 3️⃣ Extract the plan IDs
                  const planIds = groupPlanLinks.map(link => link.payment_plan_id);

                  // 4️⃣ Fetch only those payment plans
                  const paymentPlans = await PaymentPlan.findAll({
                    where: { id: planIds }
                  });
                  return {
                    ...venue,
                    classSchedules: classSchedules.map((cs) => cs.dataValues),
                    terms: allTerms.map(t => t.dataValues),   // return terms here
                    // Attach payment info
                    paymentGroup: paymentGroup ? paymentGroup.dataValues : null,

                    paymentPlans: paymentPlans.map(pp => pp.dataValues),
                  };
                })
            );
          }
        }

        return {
          ...leadWithoutBookings,
          bookingData,
          nearestVenues,
        };
      })
    );

    return {
      status: true,
      message: "Other leads retrieved successfully",
      data: formattedLeads,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllOthersLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};

// exports.getAllLeads = async (assignedAgentId, filters = {}) => {
//   try {
//     if (!assignedAgentId || isNaN(Number(assignedAgentId))) {
//       return {
//         status: false,
//         message: "No valid parent or super admin found for this request.",
//         data: [],
//       };
//     }
//     const allLeads = await Lead.findAll({
//       where: {
//         assignedAgentId: Number(assignedAgentId),
//       },
//       order: [["createdAt", "ASC"]],
//       include: [
//         {
//           model: Admin,
//           as: "assignedAgent",
//           attributes: ["id", "firstName", "lastName", "email", "roleId"],
//         },
//         {
//           model: Booking,
//           as: "bookings",
//           include: [
//             { model: Venue, as: "venue" },
//             { model: ClassSchedule, as: "classSchedule" },
//             {
//               model: BookingStudentMeta,
//               as: "students",
//               attributes: [
//                 "studentFirstName",
//                 "studentLastName",
//                 "dateOfBirth",
//                 "age",
//                 "gender",
//                 "medicalInformation",
//               ],
//               include: [
//                 {
//                   model: BookingParentMeta,
//                   as: "parents",
//                   attributes: [
//                     "parentFirstName",
//                     "parentLastName",
//                     "parentEmail",
//                     "parentPhoneNumber",
//                     "relationToChild",
//                     "howDidYouHear",
//                   ],
//                 },
//                 {
//                   model: BookingEmergencyMeta,
//                   as: "emergencyContacts",
//                   attributes: [
//                     "emergencyFirstName",
//                     "emergencyLastName",
//                     "emergencyPhoneNumber",
//                     "emergencyRelation",
//                   ],
//                 },
//               ],
//             },
//           ],
//         },
//       ],
//     });

//     const totalLeads = allLeads.length;

//     // ✅ Count "new" leads (still using lead.status)
//     const newLeadsCount = allLeads.filter(
//       (lead) => !lead.bookings || lead.bookings.length === 0
//     ).length;

//     // ✅ Count leads that have at least one "free" booking
//     const leadsToTrialsCount = allLeads.filter((lead) =>
//       (lead.bookings || []).some((b) => b.bookingType === "free")
//     ).length;

//     // ✅ Count leads that have at least one "paid" booking
//     const leadsToSalesCount = allLeads.filter((lead) =>
//       (lead.bookings || []).some((b) => b.bookingType === "paid")
//     ).length;

//     const analytics = {
//       totalLeads: {
//         count: totalLeads,
//         conversion: totalLeads ? "100%" : "0%",
//       },
//       newLeads: {
//         count: newLeadsCount,
//         conversion: totalLeads
//           ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%"
//           : "0.00%",
//       },
//       leadsToTrials: {
//         count: leadsToTrialsCount,
//         conversion: totalLeads
//           ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%"
//           : "0.00%",
//       },
//       leadsToSales: {
//         count: leadsToSalesCount,
//         conversion: totalLeads
//           ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%"
//           : "0.00%",
//       },
//     };

//     // Filters
//     let filteredLeads = allLeads;
//     if (filters.fromDate || filters.toDate) {
//       const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
//       const toDate = filters.toDate ? new Date(filters.toDate) : null;
//       if (toDate) toDate.setHours(23, 59, 59, 999);

//       filteredLeads = filteredLeads.filter((lead) => {
//         const createdAt = new Date(lead.createdAt);
//         return (
//           (!fromDate || createdAt >= fromDate) &&
//           (!toDate || createdAt <= toDate)
//         );
//       });
//     }
//     if (filters.name) {
//       const nameLower = filters.name.toLowerCase().trim();

//       filteredLeads = filteredLeads.filter((l) => {
//         const firstName = (l.firstName || "").toLowerCase();
//         const lastName = (l.lastName || "").toLowerCase();
//         const fullName = `${firstName} ${lastName}`.trim();

//         return (
//           firstName.includes(nameLower) ||
//           lastName.includes(nameLower) ||
//           fullName.includes(nameLower)
//         );
//       });
//     }

//     if (filters.status) {
//       const statusFilter = filters.status.toLowerCase().trim();
//       filteredLeads = filteredLeads.filter((lead) =>
//         (lead.bookings || []).some((booking) => {
//           const bookingStatus = (booking.status || "").toLowerCase();
//           return statusFilter === "request_to_cancel"
//             ? bookingStatus === "request_to_cancel" ||
//                 bookingStatus === "cancelled"
//             : bookingStatus === statusFilter;
//         })
//       );
//     }

//     let allVenuesList = await Venue.findAll();
//     // ✅ Venue filter
//     if (filters.venueName) {
//       const nameLower = filters.venueName.toLowerCase();

//       filteredLeads = filteredLeads.filter((lead) => {
//         // Keep only bookings that match venue
//         lead.bookings = (lead.bookings || []).filter((booking) =>
//           booking.venue?.name?.toLowerCase().includes(nameLower)
//         );
//         return lead.bookings.length > 0;
//       });
//     }

//     // ✅ Student filter
//     if (filters.studentName) {
//       const studentLower = filters.studentName.toLowerCase();

//       filteredLeads = filteredLeads.filter((lead) => {
//         // Keep only bookings where at least one student matches
//         lead.bookings = (lead.bookings || []).filter((booking) =>
//           (booking.students || []).some((student) => {
//             const fullName = `${student.studentFirstName || ""} ${
//               student.studentLastName || ""
//             }`.toLowerCase();
//             return fullName.includes(studentLower);
//           })
//         );

//         // Also trim students inside each booking to only those matching
//         lead.bookings = lead.bookings.map((booking) => ({
//           ...booking,
//           students: (booking.students || []).filter((student) => {
//             const fullName = `${student.studentFirstName || ""} ${
//               student.studentLastName || ""
//             }`.toLowerCase();
//             return fullName.includes(studentLower);
//           }),
//         }));

//         return lead.bookings.length > 0;
//       });
//     }

//     const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

//     // Format each lead
//     const formattedLeads = await Promise.all(
//       filteredLeads.map(async (lead) => {
//         const bookingData = (lead.bookings || []).map((booking) => {
//           const students = (booking.students || []).map((s) => ({
//             studentFirstName: s.studentFirstName,
//             studentLastName: s.studentLastName,
//             dateOfBirth: s.dateOfBirth,
//             age: s.age,
//             gender: s.gender,
//             medicalInformation: s.medicalInformation,
//           }));

//           const parents = (booking.students || []).flatMap((s) =>
//             (s.parents || []).map((p) => ({
//               parentFirstName: p.parentFirstName,
//               parentLastName: p.parentLastName,
//               parentEmail: p.parentEmail,
//               parentPhoneNumber: p.parentPhoneNumber,
//               relationToChild: p.relationToChild,
//               howDidYouHear: p.howDidYouHear,
//             }))
//           );

//           const emergencyContacts = (booking.students || []).flatMap((s) =>
//             (s.emergencyContacts || []).map((e) => ({
//               emergencyFirstName: e.emergencyFirstName,
//               emergencyLastName: e.emergencyLastName,
//               emergencyPhoneNumber: e.emergencyPhoneNumber,
//               emergencyRelation: e.emergencyRelation,
//             }))
//           );

//           const { students: _, ...bookingWithoutStudents } = booking.dataValues;
//           return {
//             ...bookingWithoutStudents,
//             students,
//             parents,
//             emergencyContacts,
//           };
//         });

//         const { bookings, ...leadWithoutBookings } = lead.dataValues;

//         // Nearest venues (empty array if none)
//         let nearestVenues = [];
//         if (lead.postcode && allVenuesList.length > 0) {
//           const coords = await getCoordinatesFromPostcode(lead.postcode);
//           if (coords) {
//             nearestVenues = await Promise.all(
//               allVenuesList
//                 .map((v) => ({
//                   ...v.dataValues,
//                   distance: Number(
//                     calculateDistance(
//                       coords.latitude,
//                       coords.longitude,
//                       v.latitude,
//                       v.longitude
//                     ).toFixed(2)
//                   ),
//                 }))
//                 .sort((a, b) => a.distance - b.distance)
//                 .slice(0, 5)
//                 .map(async (venue) => {
//                   // Class schedules
//                   const classSchedules = await ClassSchedule.findAll({
//                     where: { venueId: venue.id },
//                   });

//                   // Payment Groups
//                   const paymentGroups =
//                     venue.paymentGroupId != null
//                       ? await PaymentGroup.findAll({
//                           where: { id: venue.paymentGroupId },
//                           include: [
//                             {
//                               model: PaymentPlan,
//                               as: "paymentPlans",
//                               through: {
//                                 model: PaymentGroupHasPlan,
//                                 attributes: [
//                                   "id",
//                                   "payment_plan_id",
//                                   "payment_group_id",
//                                   "createdBy",
//                                   "createdAt",
//                                   "updatedAt",
//                                 ],
//                               },
//                             },
//                           ],
//                           order: [["createdAt", "DESC"]],
//                         })
//                       : [];

//                   // Term Groups
//                   let termGroupIds = [];
//                   if (typeof venue.termGroupId === "string") {
//                     try {
//                       termGroupIds = JSON.parse(venue.termGroupId);
//                     } catch {
//                       termGroupIds = [];
//                     }
//                   } else if (Array.isArray(venue.termGroupId)) {
//                     termGroupIds = venue.termGroupId;
//                   }

//                   const termGroups = termGroupIds.length
//                     ? await TermGroup.findAll({ where: { id: termGroupIds } })
//                     : [];

//                   const terms = termGroupIds.length
//                     ? await Term.findAll({
//                         where: { termGroupId: { [Op.in]: termGroupIds } },
//                         attributes: [
//                           "id",
//                           "termName",
//                           "startDate",
//                           "endDate",
//                           "termGroupId",
//                           "exclusionDates",
//                           "totalSessions",
//                           "sessionsMap",
//                         ],
//                       })
//                     : [];

//                   const parsedTerms = terms.map((t) => ({
//                     id: t.id,
//                     name: t.termName,
//                     startDate: t.startDate,
//                     endDate: t.endDate,
//                     termGroupId: t.termGroupId,
//                     exclusionDates:
//                       typeof t.exclusionDates === "string"
//                         ? JSON.parse(t.exclusionDates)
//                         : t.exclusionDates || [],
//                     totalSessions: t.totalSessions,
//                     sessionsMap:
//                       typeof t.sessionsMap === "string"
//                         ? JSON.parse(t.sessionsMap)
//                         : t.sessionsMap || [],
//                   }));

//                   return {
//                     ...venue,
//                     classSchedules: classSchedules.map((cs) => cs.dataValues),
//                     paymentGroups,
//                     termGroups: termGroups.map((tg) => ({
//                       ...tg.dataValues,
//                       terms: parsedTerms.filter((t) => t.termGroupId === tg.id),
//                     })),
//                   };
//                 })
//             );
//           }
//         }

//         return {
//           ...leadWithoutBookings,
//           bookingData, // empty if no bookings
//           nearestVenues, // empty if no nearby venues
//         };
//       })
//     );

//     // ✅ Return formatted leads
//     const leadsWithNearestVenue = formattedLeads.filter(
//       (lead) => lead.nearestVenues.length > 0
//     );

//     // ✅ Return all leads (even if nearestVenues is empty)
//     return {
//       status: true,
//       message: "Leads with nearest venues retrieved",
//       data: formattedLeads,
//       analytics,
//     };
//   } catch (error) {
//     console.error("❌ getAllLeads Error:", error.message);
//     return { status: false, message: error.message };
//   }
// };

exports.getAllLeads = async (adminId, superAdminId, filters = {}) => {
  try {
    if (!adminId || isNaN(Number(adminId))) {
      return {
        status: false,
        message: "No valid admin found for this request.",
        data: [],
      };
    }

    // ✅ Build WHERE condition for leads
    const whereLead = {};

    let allowedAdminIds = [];

    if (superAdminId && superAdminId === adminId) {
      // 🟢 Super Admin → fetch all admins under them + self
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });
      const adminIds = managedAdmins.map((a) => a.id);
      adminIds.push(superAdminId);
      allowedAdminIds = adminIds;
      whereLead.createdBy = { [Op.in]: adminIds };
    } else if (superAdminId && adminId) {
      // 🟢 Admin → fetch own + super admin’s leads
      allowedAdminIds = [adminId, superAdminId];
      whereLead.createdBy = { [Op.in]: [adminId, superAdminId] };
    } else {
      // 🟢 Fallback
      allowedAdminIds = [adminId];
      whereLead.createdBy = adminId;
    }

    // ✅ Fetch leads with related models
    const allLeads = await Lead.findAll({
      where: whereLead,
      order: [["createdAt", "ASC"]],
      include: [
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName", "email", "roleId"],
        },
        {
          model: Booking,
          as: "bookings",
          include: [
            {
              model: Venue,
              as: "venue",
              where: whereLead, // ✅ Apply createdBy filter to venue
              required: false,
            },
            {
              model: ClassSchedule,
              as: "classSchedule",
              where: whereLead, // ✅ Apply createdBy filter to class schedule
              required: false,
            },
            {
              model: BookingStudentMeta,
              as: "students",
              attributes: [
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "age",
                "gender",
                "medicalInformation",
              ],
              include: [
                {
                  model: BookingParentMeta,
                  as: "parents",
                  attributes: [
                    "parentFirstName",
                    "parentLastName",
                    "parentEmail",
                    "parentPhoneNumber",
                    "relationToChild",
                    "howDidYouHear",
                  ],
                },
                {
                  model: BookingEmergencyMeta,
                  as: "emergencyContacts",
                  attributes: [
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // ✅ Compute analytics
    const totalLeads = allLeads.length;
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;

    const leadsToTrialsCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;

    const leadsToSalesCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "paid")
    ).length;

    const analytics = {
      totalLeads: {
        count: totalLeads,
        conversion: totalLeads ? "100%" : "0%",
      },
      newLeads: {
        count: newLeadsCount,
        conversion: totalLeads
          ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToTrials: {
        count: leadsToTrialsCount,
        conversion: totalLeads
          ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToSales: {
        count: leadsToSalesCount,
        conversion: totalLeads
          ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
    };

    // ✅ Apply filters (same as before)
    let filteredLeads = allLeads;

    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (
          (!fromDate || createdAt >= fromDate) &&
          (!toDate || createdAt <= toDate)
        );
      });
    }

    if (filters.name) {
      const nameLower = filters.name.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((l) => {
        const firstName = (l.firstName || "").toLowerCase();
        const lastName = (l.lastName || "").toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        return (
          firstName.includes(nameLower) ||
          lastName.includes(nameLower) ||
          fullName.includes(nameLower)
        );
      });
    }

    if (filters.status) {
      const statusFilter = filters.status.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((lead) =>
        (lead.bookings || []).some((booking) => {
          const bookingStatus = (booking.status || "").toLowerCase();
          return statusFilter === "request_to_cancel"
            ? bookingStatus === "request_to_cancel" ||
            bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    // ✅ Venue name filter
    // let allVenuesList = await Venue.findAll({ where: whereLead });
    const allVenuesList = await Venue.findAll({
      where: { createdBy: { [Op.in]: allowedAdminIds } }
    });
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          booking.venue?.name?.toLowerCase().includes(nameLower)
        );
        return lead.bookings.length > 0;
      });
    }

    // ✅ Student filter
    if (filters.studentName) {
      const studentLower = filters.studentName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          }),
        }));
        return lead.bookings.length > 0;
      });
    }

    // ✅ Format data
    const formattedLeads = await Promise.all(
      filteredLeads.map(async (lead) => {
        const bookingData = (lead.bookings || []).map((booking) => {
          const students = (booking.students || []).map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          }));

          const parents = (booking.students || []).flatMap((s) =>
            (s.parents || []).map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            }))
          );

          const emergencyContacts = (booking.students || []).flatMap((s) =>
            (s.emergencyContacts || []).map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
          );

          const { students: _, ...bookingWithoutStudents } = booking.dataValues;
          return {
            ...bookingWithoutStudents,
            students,
            parents,
            emergencyContacts,
          };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;
        // ✅ Nearby Venues (created by allowed admins)
        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);

          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: Number(
                    calculateDistance(
                      coords.latitude,
                      coords.longitude,
                      v.latitude,
                      v.longitude
                    ).toFixed(2)
                  ),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {

                  // Debug: show the id you're looking for
                  console.log("Searching termGroupId:", venue.termGroupId[0]);

                  // Get all terms that use this termGroupId
                  const allTerms = await Term.findAll({
                    where: { createdBy: { [Op.in]: allowedAdminIds } }
                  });

                  console.log("Terms found:", allTerms.map(t => t.dataValues));

                  const classSchedules = await ClassSchedule.findAll({
                    where: { venueId: venue.id }

                  });
                  // 1️⃣ Get the Payment Group for this venue
                  const paymentGroup = await PaymentGroup.findOne({
                    where: { id: venue.paymentGroupId }
                  });

                  // 2️⃣ Get the Plan IDs from the pivot table
                  const groupPlanLinks = await PaymentGroupHasPlan.findAll({
                    where: { payment_group_id: venue.paymentGroupId },
                    attributes: ['payment_plan_id'] // only return needed column
                  });

                  // 3️⃣ Extract the plan IDs
                  const planIds = groupPlanLinks.map(link => link.payment_plan_id);

                  // 4️⃣ Fetch only those payment plans
                  const paymentPlans = await PaymentPlan.findAll({
                    where: { id: planIds }
                  });
                  return {
                    ...venue,
                    classSchedules: classSchedules.map((cs) => cs.dataValues),
                    terms: allTerms.map(t => t.dataValues),   // return terms here
                    // Attach payment info
                    paymentGroup: paymentGroup ? paymentGroup.dataValues : null,

                    paymentPlans: paymentPlans.map(pp => pp.dataValues),
                  };
                })
            );
          }
        }

        return {
          ...leadWithoutBookings,
          bookingData,
          nearestVenues,
        };
      })
    );

    // ✅ Return same structure
    return {
      status: true,
      message: "Leads with nearest venues retrieved",
      data: formattedLeads,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getLeadandBookingDatabyLeadId = async (leadId, superAdminId, adminId) => {
  try {
    if (!leadId || isNaN(Number(leadId))) {
      return {
        status: false,
        message: "Invalid leadId provided.",
        data: [],
      };
    }

    // ----------------------------------------------------
    // 🔐 ALLOWED ADMINS FIXED
    // ----------------------------------------------------
    let allowedAdminIds = [adminId];

    if (superAdminId && superAdminId === adminId) {
      const managedAdmins = await Admin.findAll({
        where: { superAdminId },
        attributes: ["id"],
      });

      allowedAdminIds = [
        superAdminId,
        ...managedAdmins.map(a => a.id),
      ];
    }

    // ----------------------------------------------------
    // 📌 Fetch Lead and related bookings
    // ----------------------------------------------------
    const lead = await Lead.findOne({
      where: { id: Number(leadId) },
      include: [
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName", "email", "roleId"],
        },
        {
          model: Booking,
          as: "bookings",
          include: [
            { model: Venue, as: "venue" },
            { model: ClassSchedule, as: "classSchedule" },
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
      ],
    });

    if (!lead) {
      return { status: false, message: "Lead not found.", data: [] };
    }

    // ----------------------------------------------------
    // 🏫 VENUES with access control
    // ----------------------------------------------------
    const allVenuesList = await Venue.findAll({
      where: { createdBy: { [Op.in]: allowedAdminIds } },
    });

    let nearestVenues = [];

    if (lead.postcode && allVenuesList.length > 0) {
      const coords = await getCoordinatesFromPostcode(lead.postcode);

      if (coords) {
        nearestVenues = await Promise.all(
          allVenuesList
            .map((v) => ({
              ...v.dataValues,
              distance: Number(
                calculateDistance(
                  coords.latitude,
                  coords.longitude,
                  v.latitude,
                  v.longitude
                ).toFixed(2)
              ),
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 5)
            .map(async (venue) => {
              const allTerms = await Term.findAll({
                where: { createdBy: { [Op.in]: allowedAdminIds } },
              });

              const classSchedules = await ClassSchedule.findAll({
                where: { venueId: venue.id },
              });

              const paymentGroup = await PaymentGroup.findOne({
                where: { id: venue.paymentGroupId },
              });

              const groupPlanLinks = await PaymentGroupHasPlan.findAll({
                where: { payment_group_id: venue.paymentGroupId },
                attributes: ["payment_plan_id"],
              });

              const planIds = groupPlanLinks.map((l) => l.payment_plan_id);

              const paymentPlans = await PaymentPlan.findAll({
                where: { id: planIds },
              });

              return {
                ...venue,
                classSchedules: classSchedules.map((c) => c.dataValues),
                terms: allTerms.map((t) => t.dataValues),
                paymentGroup: paymentGroup ? paymentGroup.dataValues : null,
                paymentPlans: paymentPlans.map((p) => p.dataValues),
              };
            })
        );
      }
    }

    return {
      status: true,
      message: "Lead with full booking data and nearest venues retrieved successfully.",
      data: {
        ...lead.dataValues,
        nearestVenues,
      },
    };
  } catch (error) {
    console.error("❌ getLeadandBookingDatabyLeadId Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.findAClass = async (filters = {}) => {
  try {
    const allLeads = await Lead.findAll({
      order: [["createdAt", "ASC"]],
      include: [
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName", "email", "roleId"],
        },
        {
          model: Booking,
          as: "bookings",
          include: [
            { model: Venue, as: "venue" },
            { model: ClassSchedule, as: "classSchedule" },
            {
              model: BookingStudentMeta,
              as: "students",
              attributes: [
                "studentFirstName",
                "studentLastName",
                "dateOfBirth",
                "age",
                "gender",
                "medicalInformation",
              ],
              include: [
                {
                  model: BookingParentMeta,
                  as: "parents",
                  attributes: [
                    "parentFirstName",
                    "parentLastName",
                    "parentEmail",
                    "parentPhoneNumber",
                    "relationToChild",
                    "howDidYouHear",
                  ],
                },
                {
                  model: BookingEmergencyMeta,
                  as: "emergencyContacts",
                  attributes: [
                    "emergencyFirstName",
                    "emergencyLastName",
                    "emergencyPhoneNumber",
                    "emergencyRelation",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const totalLeads = allLeads.length;

    // Analytics
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;
    const leadsToTrialsCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;
    const leadsToSalesCount = allLeads.filter((lead) =>
      (lead.bookings || []).some((b) => b.bookingType === "paid")
    ).length;

    const analytics = {
      totalLeads: { count: totalLeads, conversion: totalLeads ? "100%" : "0%" },
      newLeads: {
        count: newLeadsCount,
        conversion: totalLeads
          ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToTrials: {
        count: leadsToTrialsCount,
        conversion: totalLeads
          ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
      leadsToSales: {
        count: leadsToSalesCount,
        conversion: totalLeads
          ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%"
          : "0.00%",
      },
    };

    // Filters
    let filteredLeads = allLeads;

    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (
          (!fromDate || createdAt >= fromDate) &&
          (!toDate || createdAt <= toDate)
        );
      });
    }

    if (filters.name) {
      const nameLower = filters.name.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((l) => {
        const firstName = (l.firstName || "").toLowerCase();
        const lastName = (l.lastName || "").toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        return (
          firstName.includes(nameLower) ||
          lastName.includes(nameLower) ||
          fullName.includes(nameLower)
        );
      });
    }

    if (filters.status) {
      const statusFilter = filters.status.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((lead) =>
        (lead.bookings || []).some((booking) => {
          const bookingStatus = (booking.status || "").toLowerCase();
          return statusFilter === "request_to_cancel"
            ? bookingStatus === "request_to_cancel" ||
            bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    // Venue filter
    let allVenuesList = await Venue.findAll();
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((b) =>
          b.venue?.name.toLowerCase().includes(nameLower)
        );
        return lead.bookings.length > 0;
      });
    }

    // Student name filter
    if (filters.studentName) {
      const studentLower = filters.studentName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""
              }`.toLowerCase();
            return fullName.includes(studentLower);
          }),
        }));
        return lead.bookings.length > 0;
      });
    }

    const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

    // Format leads with bookings and nearest venues
    const formattedLeads = await Promise.all(
      filteredLeads.map(async (lead) => {
        const bookingData = (lead.bookings || []).map((booking) => {
          const students = (booking.students || []).map((s) => ({
            studentFirstName: s.studentFirstName,
            studentLastName: s.studentLastName,
            dateOfBirth: s.dateOfBirth,
            age: s.age,
            gender: s.gender,
            medicalInformation: s.medicalInformation,
          }));

          const parents = (booking.students || []).flatMap((s) =>
            (s.parents || []).map((p) => ({
              parentFirstName: p.parentFirstName,
              parentLastName: p.parentLastName,
              parentEmail: p.parentEmail,
              parentPhoneNumber: p.parentPhoneNumber,
              relationToChild: p.relationToChild,
              howDidYouHear: p.howDidYouHear,
            }))
          );

          const emergencyContacts = (booking.students || []).flatMap((s) =>
            (s.emergencyContacts || []).map((e) => ({
              emergencyFirstName: e.emergencyFirstName,
              emergencyLastName: e.emergencyLastName,
              emergencyPhoneNumber: e.emergencyPhoneNumber,
              emergencyRelation: e.emergencyRelation,
            }))
          );

          const { students: _, ...bookingWithoutStudents } = booking.dataValues;
          return {
            ...bookingWithoutStudents,
            students,
            parents,
            emergencyContacts,
          };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;

        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);
          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: Number(
                    calculateDistance(
                      coords.latitude,
                      coords.longitude,
                      v.latitude,
                      v.longitude
                    ).toFixed(2)
                  ),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {
                  // Class schedules
                  const classSchedules = await ClassSchedule.findAll({
                    where: { venueId: venue.id },
                  });

                  // Payment Groups
                  const paymentGroups =
                    venue.paymentGroupId != null
                      ? await PaymentGroup.findAll({
                        where: { id: venue.paymentGroupId },
                        include: [
                          {
                            model: PaymentPlan,
                            as: "paymentPlans",
                            through: {
                              model: PaymentGroupHasPlan,
                              attributes: [
                                "id",
                                "payment_plan_id",
                                "payment_group_id",
                                "createdBy",
                                "createdAt",
                                "updatedAt",
                              ],
                            },
                          },
                        ],
                        order: [["createdAt", "DESC"]],
                      })
                      : [];

                  // Term Groups
                  let termGroupIds = [];
                  if (typeof venue.termGroupId === "string") {
                    try {
                      termGroupIds = JSON.parse(venue.termGroupId);
                    } catch {
                      termGroupIds = [];
                    }
                  } else if (Array.isArray(venue.termGroupId)) {
                    termGroupIds = venue.termGroupId;
                  }

                  const termGroups = termGroupIds.length
                    ? await TermGroup.findAll({ where: { id: termGroupIds } })
                    : [];

                  const terms = termGroupIds.length
                    ? await Term.findAll({
                      where: { termGroupId: { [Op.in]: termGroupIds } },
                      attributes: [
                        "id",
                        "termName",
                        "startDate",
                        "endDate",
                        "termGroupId",
                        "exclusionDates",
                        "totalSessions",
                        "sessionsMap",
                      ],
                    })
                    : [];

                  const parsedTerms = terms.map((t) => ({
                    id: t.id,
                    name: t.termName,
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

                  return {
                    ...venue,
                    classSchedules: classSchedules.map((cs) => cs.dataValues),
                    paymentGroups,
                    termGroups: termGroups.map((tg) => ({
                      ...tg.dataValues,
                      terms: parsedTerms.filter((t) => t.termGroupId === tg.id),
                    })),
                  };
                })
            );
          }
        }

        return {
          ...leadWithoutBookings,
          bookingData, // empty if no bookings
          nearestVenues, // empty if no nearby venues
        };
      })
    );

    const leadsWithNearestVenue = formattedLeads.filter(
      (lead) => lead.nearestVenues.length > 0
    );

    return {
      status: true,
      message: "Leads with nearest venues retrieved",
      data: leadsWithNearestVenue,
      analytics,
    };
  } catch (error) {
    console.error("❌ findAClass Error:", error.message);
    return { status: false, message: error.message };
  }
};
