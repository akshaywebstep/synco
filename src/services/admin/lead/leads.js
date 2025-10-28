const { Lead, Venue, Comment, Admin, ClassSchedule, Booking, BookingStudentMeta, BookingParentMeta, BookingEmergencyMeta, PaymentGroup, TermGroup, Term, PaymentPlan, PaymentGroupHasPlan } = require("../../../models");
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

// Convert postcode to coordinates (UK example using Postcodes.io)
async function getCoordinatesFromPostcode(postcode) {
  try {
    const res = await axios.get(
      `https://api.postcodes.io/postcodes/${postcode}`
    );
    if (res.data.status === 200) {
      return {
        latitude: res.data.result.latitude,
        longitude: res.data.result.longitude,
      };
    }
  } catch (err) {
    console.error("❌ Postcode lookup error:", err.message);
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
          ("❌ Admin not found:", commentBy);
        }
        return { status: false, message: "❌ Admin not found." };
      }
      if (DEBUG) {
        ("✅ Admin validated:", admin.id);
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
      ("✅ Comment created:", newComment.id);

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
      ("❌ addCommentForLead Error:", error);
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
          attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"],
          required: false,
        },
      ],

      order: [["createdAt", "ASC"]],
    });

    if (DEBUG) {
      (`✅ Found ${comments.length} comments`);
    }
    return {
      status: true,
      message: "✅ Comments fetched successfully",
      data: comments,
    };
  } catch (error) {
    if (DEBUG) {
      ("❌ listComments Error:", error);
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
exports.getAllForFacebookLeads = async (filters = {}) => {
  try {
    const allLeads = await Lead.findAll({
      order: [["createdAt", "ASC"]],
      where: { status: "facebook" },
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

    // ✅ Count "new" leads (still using lead.status)
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;

    // ✅ Count leads that have at least one "free" booking
    const leadsToTrialsCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;

    // ✅ Count leads that have at least one "paid" booking
    const leadsToSalesCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "paid")
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

    // Filters
    let filteredLeads = allLeads;
    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (!fromDate || createdAt >= fromDate) && (!toDate || createdAt <= toDate);
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
      filteredLeads = filteredLeads.filter((l) => l.status === filters.status);
    }

    let allVenuesList = await Venue.findAll();
    // ✅ Venue filter
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();

      filteredLeads = filteredLeads.filter((lead) => {
        // Keep only bookings that match venue
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
        // Keep only bookings where at least one student matches
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );

        // Also trim students inside each booking to only those matching
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          }),
        }));

        return lead.bookings.length > 0;
      });
    }

    const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

    // Format each lead
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
          return { ...bookingWithoutStudents, students, parents, emergencyContacts };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;

        // Nearest venues (empty array if none)
        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);
          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: calculateDistance(coords.latitude, coords.longitude, v.latitude, v.longitude),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {
                  // Class schedules
                  const classSchedules = await ClassSchedule.findAll({ where: { venueId: venue.id } });

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
                              attributes: ["id", "payment_plan_id", "payment_group_id", "createdBy", "createdAt", "updatedAt"],
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
                      typeof t.exclusionDates === "string" ? JSON.parse(t.exclusionDates) : t.exclusionDates || [],
                    totalSessions: t.totalSessions,
                    sessionsMap: typeof t.sessionsMap === "string" ? JSON.parse(t.sessionsMap) : t.sessionsMap || [],
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
          bookingData,       // empty if no bookings
          nearestVenues,     // empty if no nearby venues
        };
      })
    );

    // ✅ Return formatted leads
    const leadsWithNearestVenue = formattedLeads.filter((lead) => lead.nearestVenues.length > 0);

    return {
      status: true,
      message: "Leads with nearest venues retrieved",
      data: leadsWithNearestVenue,
      // allVenues,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getAllReferallLeads = async (filters = {}) => {
  try {
    const allLeads = await Lead.findAll({
      order: [["createdAt", "ASC"]],
      where: { status: "referall" },
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

    // ✅ Count "new" leads (still using lead.status)
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;

    // ✅ Count leads that have at least one "free" booking
    const leadsToTrialsCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;

    // ✅ Count leads that have at least one "paid" booking
    const leadsToSalesCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "paid")
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

    // Filters
    let filteredLeads = allLeads;
    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (!fromDate || createdAt >= fromDate) && (!toDate || createdAt <= toDate);
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
            ? bookingStatus === "request_to_cancel" || bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    let allVenuesList = await Venue.findAll();
    // ✅ Venue filter
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();

      filteredLeads = filteredLeads.filter((lead) => {
        // Keep only bookings that match venue
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
        // Keep only bookings where at least one student matches
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );

        // Also trim students inside each booking to only those matching
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          }),
        }));

        return lead.bookings.length > 0;
      });
    }

    const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

    // Format each lead
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
          return { ...bookingWithoutStudents, students, parents, emergencyContacts };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;

        // Nearest venues (empty array if none)
        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);
          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: calculateDistance(coords.latitude, coords.longitude, v.latitude, v.longitude),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {
                  // Class schedules
                  const classSchedules = await ClassSchedule.findAll({ where: { venueId: venue.id } });

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
                              attributes: ["id", "payment_plan_id", "payment_group_id", "createdBy", "createdAt", "updatedAt"],
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
                      typeof t.exclusionDates === "string" ? JSON.parse(t.exclusionDates) : t.exclusionDates || [],
                    totalSessions: t.totalSessions,
                    sessionsMap: typeof t.sessionsMap === "string" ? JSON.parse(t.sessionsMap) : t.sessionsMap || [],
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
          bookingData,       // empty if no bookings
          nearestVenues,     // empty if no nearby venues
        };
      })
    );

    // ✅ Return formatted leads
    const leadsWithNearestVenue = formattedLeads.filter((lead) => lead.nearestVenues.length > 0);

    return {
      status: true,
      message: "Leads with nearest venues retrieved",
      data: leadsWithNearestVenue,
      // allVenues,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getAllOthersLeads = async (assignedAgentId,filters = {}) => {
  try {
     if (!assignedAgentId || isNaN(Number(assignedAgentId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }
    const allLeads = await Lead.findAll({
      order: [["createdAt", "ASC"]],
      where: { assignedAgentId: Number(assignedAgentId),status: "others" },
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

    // ✅ Count "new" leads (still using lead.status)
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;

    // ✅ Count leads that have at least one "free" booking
    const leadsToTrialsCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;

    // ✅ Count leads that have at least one "paid" booking
    const leadsToSalesCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "paid")
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

    // Filters
    let filteredLeads = allLeads;
    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (!fromDate || createdAt >= fromDate) && (!toDate || createdAt <= toDate);
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
            ? bookingStatus === "request_to_cancel" || bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    let allVenuesList = await Venue.findAll();
    // ✅ Venue filter
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();

      filteredLeads = filteredLeads.filter((lead) => {
        // Keep only bookings that match venue
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
        // Keep only bookings where at least one student matches
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );

        // Also trim students inside each booking to only those matching
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          }),
        }));

        return lead.bookings.length > 0;
      });
    }

    const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

    // Format each lead
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
          return { ...bookingWithoutStudents, students, parents, emergencyContacts };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;

        // Nearest venues (empty array if none)
        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);
          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: calculateDistance(coords.latitude, coords.longitude, v.latitude, v.longitude),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {
                  // Class schedules
                  const classSchedules = await ClassSchedule.findAll({ where: { venueId: venue.id } });

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
                              attributes: ["id", "payment_plan_id", "payment_group_id", "createdBy", "createdAt", "updatedAt"],
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
                      typeof t.exclusionDates === "string" ? JSON.parse(t.exclusionDates) : t.exclusionDates || [],
                    totalSessions: t.totalSessions,
                    sessionsMap: typeof t.sessionsMap === "string" ? JSON.parse(t.sessionsMap) : t.sessionsMap || [],
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
          bookingData,       // empty if no bookings
          nearestVenues,     // empty if no nearby venues
        };
      })
    );

    // ✅ Return formatted leads
    const leadsWithNearestVenue = formattedLeads.filter((lead) => lead.nearestVenues.length > 0);

    return {
      status: true,
      message: "Other leads retrieved successfully",
      data: formattedLeads,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};

exports.getAllLeads = async (assignedAgentId, filters = {}) => {
  try {
    if (!assignedAgentId || isNaN(Number(assignedAgentId))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }
    const allLeads = await Lead.findAll({
      where: { assignedAgentId: Number(assignedAgentId) },
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

    // ✅ Count "new" leads (still using lead.status)
    const newLeadsCount = allLeads.filter(
      (lead) => !lead.bookings || lead.bookings.length === 0
    ).length;

    // ✅ Count leads that have at least one "free" booking
    const leadsToTrialsCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "free")
    ).length;

    // ✅ Count leads that have at least one "paid" booking
    const leadsToSalesCount = allLeads.filter(
      (lead) => (lead.bookings || []).some((b) => b.bookingType === "paid")
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

    // Filters
    let filteredLeads = allLeads;
    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (!fromDate || createdAt >= fromDate) && (!toDate || createdAt <= toDate);
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
            ? bookingStatus === "request_to_cancel" || bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    let allVenuesList = await Venue.findAll();
    // ✅ Venue filter
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();

      filteredLeads = filteredLeads.filter((lead) => {
        // Keep only bookings that match venue
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
        // Keep only bookings where at least one student matches
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );

        // Also trim students inside each booking to only those matching
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          }),
        }));

        return lead.bookings.length > 0;
      });
    }

    const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

    // Format each lead
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
          return { ...bookingWithoutStudents, students, parents, emergencyContacts };
        });

        const { bookings, ...leadWithoutBookings } = lead.dataValues;

        // Nearest venues (empty array if none)
        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);
          if (coords) {
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: calculateDistance(coords.latitude, coords.longitude, v.latitude, v.longitude),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {
                  // Class schedules
                  const classSchedules = await ClassSchedule.findAll({ where: { venueId: venue.id } });

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
                              attributes: ["id", "payment_plan_id", "payment_group_id", "createdBy", "createdAt", "updatedAt"],
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
                      typeof t.exclusionDates === "string" ? JSON.parse(t.exclusionDates) : t.exclusionDates || [],
                    totalSessions: t.totalSessions,
                    sessionsMap: typeof t.sessionsMap === "string" ? JSON.parse(t.sessionsMap) : t.sessionsMap || [],
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
          bookingData,       // empty if no bookings
          nearestVenues,     // empty if no nearby venues
        };
      })
    );

    // ✅ Return formatted leads
    const leadsWithNearestVenue = formattedLeads.filter((lead) => lead.nearestVenues.length > 0);

    // ✅ Return all leads (even if nearestVenues is empty)
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
    const newLeadsCount = allLeads.filter((lead) => !lead.bookings || lead.bookings.length === 0).length;
    const leadsToTrialsCount = allLeads.filter((lead) => (lead.bookings || []).some(b => b.bookingType === "free")).length;
    const leadsToSalesCount = allLeads.filter((lead) => (lead.bookings || []).some(b => b.bookingType === "paid")).length;

    const analytics = {
      totalLeads: { count: totalLeads, conversion: totalLeads ? "100%" : "0%" },
      newLeads: { count: newLeadsCount, conversion: totalLeads ? ((newLeadsCount / totalLeads) * 100).toFixed(2) + "%" : "0.00%" },
      leadsToTrials: { count: leadsToTrialsCount, conversion: totalLeads ? ((leadsToTrialsCount / totalLeads) * 100).toFixed(2) + "%" : "0.00%" },
      leadsToSales: { count: leadsToSalesCount, conversion: totalLeads ? ((leadsToSalesCount / totalLeads) * 100).toFixed(2) + "%" : "0.00%" },
    };

    // Filters
    let filteredLeads = allLeads;

    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      const toDate = filters.toDate ? new Date(filters.toDate) : null;
      if (toDate) toDate.setHours(23, 59, 59, 999);

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (!fromDate || createdAt >= fromDate) && (!toDate || createdAt <= toDate);
      });
    }

    if (filters.name) {
      const nameLower = filters.name.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((l) => {
        const firstName = (l.firstName || "").toLowerCase();
        const lastName = (l.lastName || "").toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        return firstName.includes(nameLower) || lastName.includes(nameLower) || fullName.includes(nameLower);
      });
    }

    if (filters.status) {
      const statusFilter = filters.status.toLowerCase().trim();
      filteredLeads = filteredLeads.filter((lead) =>
        (lead.bookings || []).some((booking) => {
          const bookingStatus = (booking.status || "").toLowerCase();
          return statusFilter === "request_to_cancel"
            ? bookingStatus === "request_to_cancel" || bookingStatus === "cancelled"
            : bookingStatus === statusFilter;
        })
      );
    }

    // Venue filter
    let allVenuesList = await Venue.findAll();
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((b) => b.venue?.name.toLowerCase().includes(nameLower));
        return lead.bookings.length > 0;
      });
    }

    // Student name filter
    if (filters.studentName) {
      const studentLower = filters.studentName.toLowerCase();
      filteredLeads = filteredLeads.filter((lead) => {
        lead.bookings = (lead.bookings || []).filter((booking) =>
          (booking.students || []).some((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
            return fullName.includes(studentLower);
          })
        );
        lead.bookings = lead.bookings.map((booking) => ({
          ...booking,
          students: (booking.students || []).filter((student) => {
            const fullName = `${student.studentFirstName || ""} ${student.studentLastName || ""}`.toLowerCase();
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
          return { ...bookingWithoutStudents, students, parents, emergencyContacts };
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
                  distance: calculateDistance(coords.latitude, coords.longitude, v.latitude, v.longitude),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {
                  // Class schedules
                  const classSchedules = await ClassSchedule.findAll({ where: { venueId: venue.id } });

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
                              attributes: ["id", "payment_plan_id", "payment_group_id", "createdBy", "createdAt", "updatedAt"],
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
                      typeof t.exclusionDates === "string" ? JSON.parse(t.exclusionDates) : t.exclusionDates || [],
                    totalSessions: t.totalSessions,
                    sessionsMap: typeof t.sessionsMap === "string" ? JSON.parse(t.sessionsMap) : t.sessionsMap || [],
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
          bookingData,       // empty if no bookings
          nearestVenues,     // empty if no nearby venues
        };
      })
    );

    const leadsWithNearestVenue = formattedLeads.filter((lead) => lead.nearestVenues.length > 0);

    return { status: true, message: "Leads with nearest venues retrieved", data: leadsWithNearestVenue, analytics };
  } catch (error) {
    console.error("❌ findAClass Error:", error.message);
    return { status: false, message: error.message };
  }
};
