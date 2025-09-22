const {
  Venue,
  Term,
  TermGroup,
  SessionPlanGroup,
  SessionExercise,
  PaymentPlan,
  PaymentGroup,
  // PaymentGroupHasPlan,
} = require("../../../models");
const axios = require("axios");
const https = require("https");

const { Op } = require("sequelize");

const parseSessionPlanGroupLevels = async (sessionPlanGroup) => {
  if (!sessionPlanGroup || !sessionPlanGroup.levels) return;

  let parsedLevels = {};
  try {
    parsedLevels =
      typeof sessionPlanGroup.levels === "string"
        ? JSON.parse(sessionPlanGroup.levels)
        : sessionPlanGroup.levels;
  } catch (err) {
    console.warn(`⚠️ Could not parse levels for SPG ID ${sessionPlanGroup.id}`);
    parsedLevels = {};
  }

  // ✅ Collect all unique sessionExerciseIds across all levels
  const allIds = [];

  Object.entries(parsedLevels).forEach(([levelKey, levelArray]) => {
    if (!Array.isArray(levelArray)) {
      console.warn(
        `⚠️ Skipping level "${levelKey}" because it's not an array:`,
        levelArray
      );
      parsedLevels[levelKey] = []; // make it safe for later
      return;
    }

    levelArray.forEach((item) => {
      if (typeof item.sessionExerciseId === "string") {
        try {
          item.sessionExerciseId = JSON.parse(item.sessionExerciseId);
        } catch {
          item.sessionExerciseId = [];
        }
      }

      if (!Array.isArray(item.sessionExerciseId)) {
        item.sessionExerciseId = [];
      }

      allIds.push(...item.sessionExerciseId);
    });
  });

  const uniqueIds = [...new Set(allIds)];

  // ✅ Fetch all exercises in one go
  const exercises = uniqueIds.length
    ? await SessionExercise.findAll({
      where: { id: uniqueIds },
      attributes: ["id", "title", "description", "duration"],
      raw: true,
    })
    : [];

  // ✅ Build map for lookup
  const exerciseMap = {};
  exercises.forEach((ex) => {
    exerciseMap[ex.id] = ex;
  });

  // ✅ Attach exercise data inline
  Object.entries(parsedLevels).forEach(([levelKey, levelArray]) => {
    if (!Array.isArray(levelArray)) return;

    levelArray.forEach((item) => {
      const ids = Array.isArray(item.sessionExerciseId)
        ? item.sessionExerciseId
        : [];
      item.sessionExercises = ids.map((id) => exerciseMap[id]).filter(Boolean);
    });
  });

  // ✅ Final safe assignment
  sessionPlanGroup.dataValues.levels = parsedLevels;
};

async function geocodeAddress(address, fallbackArea) {
  const agent = new https.Agent({ family: 4 }); // force IPv4
  const queries = [address]; // try main address first
  if (fallbackArea) queries.push(fallbackArea); // then area if needed

  for (let q of queries) {
    const cleanQuery = encodeURIComponent(q.trim());
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${cleanQuery}`;
    console.log("🌍 Geocoding:", url);

    try {
      const res = await axios.get(url, {
        headers: { "User-Agent": "VenueApp/1.0 (admin@yourapp.com)" },
        timeout: 7000, // 7 sec per request
        httpsAgent: agent,
      });

      if (res.data && res.data.length > 0) {
        const place = res.data[0];
        return {
          latitude: parseFloat(place.lat),
          longitude: parseFloat(place.lon),
          postal_code: place.address?.postcode
            ? String(place.address.postcode).trim()
            : null,
        };
      }
    } catch (err) {
      console.warn("⚠ Geocode attempt failed:", err.code || err.message);
    }
  }

  // If nothing found
  return null;
}

// ✅ Create Venue
// exports.createVenue = async (data) => {
//   try {
//     // Parse termGroupId
//     if (typeof data.termGroupId === "string") {
//       data.termGroupId = data.termGroupId
//         .split(",")
//         .map((id) => parseInt(id.trim()))
//         .filter((id) => !isNaN(id));
//     }

//     // Parse paymentPlanId
//     if (typeof data.paymentPlanId === "string") {
//       data.paymentPlanId = data.paymentPlanId
//         .split(",")
//         .map((id) => parseInt(id.trim()))
//         .filter((id) => !isNaN(id));
//     }

//     // ✅ Convert arrays to JSON string before saving
//     if (Array.isArray(data.termGroupId)) {
//       data.termGroupId = JSON.stringify(data.termGroupId);
//     }

//     if (Array.isArray(data.paymentPlanId)) {
//       data.paymentPlanId = JSON.stringify(data.paymentPlanId);
//     }

//     // Geocode address
//     const coords = await geocodeAddress(data.address, data.area);
//     if (coords) {
//       data.latitude = coords.latitude;
//       data.longitude = coords.longitude;
//       data.postal_code = coords.postal_code;
//     }

//     // createdBy must exist
//     if (!data.createdBy) {
//       throw new Error("createdBy is required");
//     }

//     const venue = await Venue.create(data);
//     return { status: true, data: venue };
//   } catch (error) {
//     console.error("❌ Venue create error:", error.message);
//     return { status: false, message: error.message };
//   }
// };
// ✅ Create Venue
exports.createVenue = async (data) => {
  try {
    // ✅ Parse termGroupId
    if (typeof data.termGroupId === "string") {
      data.termGroupId = data.termGroupId
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
    }

    // ✅ Parse paymentGroupId
    if (typeof data.paymentGroupId === "string") {
      data.paymentGroupId = data.paymentGroupId
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
    }

    // ✅ Convert arrays to JSON string before saving
    if (Array.isArray(data.termGroupId)) {
      data.termGroupId = JSON.stringify(data.termGroupId);
    }

    if (Array.isArray(data.paymentGroupId)) {
      data.paymentGroupId = JSON.stringify(data.paymentGroupId);
    }

    // ✅ Geocode address
    const coords = await geocodeAddress(data.address, data.area);
    if (coords) {
      data.latitude = coords.latitude;
      data.longitude = coords.longitude;
      data.postal_code = coords.postal_code;
    }

    // ✅ createdBy must exist
    if (!data.createdBy) {
      throw new Error("createdBy is required");
    }

    // ✅ Create venue
    const venue = await Venue.create(data);

    // ✅ Optional: enrich with PaymentGroups and their plans
    let paymentGroups = [];
    const paymentGroupIds = Array.isArray(venue.paymentGroupId)
      ? venue.paymentGroupId
      : JSON.parse(venue.paymentGroupId || "[]");

    if (paymentGroupIds.length > 0) {
      paymentGroups = await PaymentGroup.findAll({
        where: { id: paymentGroupIds },
        include: [{ model: PaymentPlan, as: "paymentPlans" }],
      });
    }

    venue.dataValues.paymentGroups = paymentGroups;

    return { status: true, data: venue };
  } catch (error) {
    console.error("❌ Venue create error:", error.message);
    return { status: false, message: error.message };
  }
};

// exports.getAllVenues = async (createdBy) => {
//   try {
//     const venues = await Venue.findAll({
//       where: { createdBy },
//       order: [["createdAt", "DESC"]],
//     });

//     for (const venue of venues) {
//       // ✅ Parse paymentPlanId
//       let paymentPlanIds = [];
//       if (typeof venue.paymentPlanId === "string") {
//         try {
//           paymentPlanIds = JSON.parse(venue.paymentPlanId);
//           venue.dataValues.paymentPlanId = paymentPlanIds;
//         } catch {
//           paymentPlanIds = [];
//           venue.dataValues.paymentPlanId = [];
//         }
//       } else {
//         paymentPlanIds = venue.paymentPlanId || [];
//       }

//       // ✅ Fetch and attach PaymentPlans
//       if (paymentPlanIds.length > 0) {
//         const plans = await PaymentPlan.findAll({
//           where: { id: paymentPlanIds },
//         });
//         venue.dataValues.paymentPlans = plans;
//       } else {
//         venue.dataValues.paymentPlans = [];
//       }

//       // ✅ Optional: Parse termGroupId if stored as string
//       if (typeof venue.termGroupId === "string") {
//         try {
//           venue.dataValues.termGroupId = JSON.parse(venue.termGroupId);
//         } catch {
//           venue.dataValues.termGroupId = [];
//         }
//       }

//       // ✅ Parse termGroupId
//       let termGroupIds = [];

//       if (typeof venue.termGroupId === "string") {
//         try {
//           termGroupIds = venue.termGroupId
//             .split(",")
//             .map((id) => parseInt(id.trim()));
//         } catch {
//           termGroupIds = [];
//         }
//       } else if (Array.isArray(venue.termGroupId)) {
//         termGroupIds = venue.termGroupId;
//       }

//       // ✅ Fetch associated term groups manually
//       if (termGroupIds.length > 0) {
//         const termGroups = await TermGroup.findAll({
//           where: { id: termGroupIds },
//           include: [
//             {
//               model: Term,
//               as: "terms",
//               attributes: [
//                 "id",
//                 "termGroupId",
//                 "termName",
//                 "startDate",
//                 "endDate",
//                 "exclusionDates",
//                 "totalSessions",
//                 "sessionsMap",
//               ],
//             },
//           ],
//         });

//         venue.dataValues.termGroups = termGroups; // 👈 set to plural
//         for (const termGroup of termGroups) {
//           if (termGroup?.terms?.length) {
//             for (const term of termGroup.terms) {
//               // ✅ Parse exclusionDates
//               if (typeof term.exclusionDates === "string") {
//                 try {
//                   term.dataValues.exclusionDates = JSON.parse(
//                     term.exclusionDates
//                   );
//                 } catch {
//                   term.dataValues.exclusionDates = [];
//                 }
//               }

//               // ✅ Parse sessionsMap
//               let parsedSessionsMap = [];
//               if (typeof term.sessionsMap === "string") {
//                 try {
//                   parsedSessionsMap = JSON.parse(term.sessionsMap);
//                   term.dataValues.sessionsMap = parsedSessionsMap;
//                 } catch {
//                   parsedSessionsMap = [];
//                   term.dataValues.sessionsMap = [];
//                 }
//               } else {
//                 parsedSessionsMap = term.sessionsMap || [];
//               }

//               // ✅ Enrich each sessionMap entry with its sessionPlan
//               for (let i = 0; i < parsedSessionsMap.length; i++) {
//                 const entry = parsedSessionsMap[i];
//                 if (!entry.sessionPlanId) continue;

//                 const spg = await SessionPlanGroup.findByPk(
//                   entry.sessionPlanId,
//                   {
//                     attributes: [
//                       "id",
//                       "groupName",
//                       "levels",
//                       "video",
//                       "banner",
//                       "player",
//                     ],
//                   }
//                 );

//                 if (spg) {
//                   await parseSessionPlanGroupLevels(spg); // ← assumes you have this function
//                   entry.sessionPlan = spg;
//                 } else {
//                   entry.sessionPlan = null;
//                 }
//               }

//               term.dataValues.sessionsMap = parsedSessionsMap;
//             }
//           }
//         }
//       } else {
//         venue.dataValues.termGroups = [];
//       }
//     }

//     return {
//       status: true,
//       message: "Venues fetched successfully.",
//       data: venues,
//     };
//   } catch (error) {
//     console.error("❌ getAllVenues Error:", error);
//     return {
//       status: false,
//       message: "Failed to fetch venues.",
//     };
//   }
// };

exports.getAllVenues = async (createdBy) => {
  try {
    const venues = await Venue.findAll({
      where: { createdBy },
      order: [["createdAt", "DESC"]],
      attributes: [
        "id",
        "area",
        "name",
        "address",
        "facility",
        "parkingNote",
        "howToEnterFacility",
        "paymentGroupId", // ✅ use this field
        "isCongested",
        "hasParking",
        "termGroupId",
        "latitude",
        "longitude",
        "postal_code",
        "createdBy",
        "createdAt",
        "updatedAt",
      ],
    });

    for (const venue of venues) {
      // ✅ Parse paymentGroupId
      let paymentGroupIds = [];
      if (typeof venue.paymentGroupId === "string") {
        try {
          paymentGroupIds = JSON.parse(venue.paymentGroupId);
          venue.dataValues.paymentGroupId = paymentGroupIds;
        } catch {
          paymentGroupIds = [];
          venue.dataValues.paymentGroupId = [];
        }
      } else {
        paymentGroupIds = venue.paymentGroupId || [];
      }

      // ✅ Fetch PaymentGroups with their PaymentPlans
      let paymentGroups = [];
      if (paymentGroupIds.length > 0) {
        paymentGroups = await PaymentGroup.findAll({
          where: { id: paymentGroupIds },
          include: [
            {
              model: PaymentPlan,
              as: "paymentPlans", // must match association alias
              attributes: [
                "id",
                "title",
                "price",
                "priceLesson",
                "interval",
                "duration",
                "students",
                "joiningFee",
                "HolidayCampPackage",
                "termsAndCondition",
                "createdBy",
                "createdAt",
                "updatedAt",
              ],
            },
          ],
          order: [["createdAt", "DESC"]],
        });
      }
      venue.dataValues.paymentGroups = paymentGroups; // keep grouped structure

      // ✅ Parse termGroupId
      if (typeof venue.termGroupId === "string") {
        try {
          venue.dataValues.termGroupId = JSON.parse(venue.termGroupId);
        } catch {
          venue.dataValues.termGroupId = [];
        }
      }
    }

    return {
      status: true,
      message: "Venues fetched successfully.",
      data: venues,
    };
  } catch (error) {
    console.error("❌ getAllVenues Error:", error);
    return {
      status: false,
      message: "Failed to fetch venues.",
    };
  }
};

// exports.getVenueById = async (id, createdBy) => {
//   try {
//     console.log("🔍 Fetching venue by ID:", id);

//     const venue = await Venue.findOne({
//       where: { id, createdBy }, // ✅ Scope to admin
//     });

//     if (!venue) {
//       console.warn("❌ Venue not found or unauthorized.");
//       return { status: false, message: "Venue not found." };
//     }

//     // ✅ Parse paymentPlanId
//     let paymentPlanIds = [];
//     if (typeof venue.paymentPlanId === "string") {
//       try {
//         paymentPlanIds = JSON.parse(venue.paymentPlanId);
//         venue.dataValues.paymentPlanId = paymentPlanIds;
//       } catch {
//         paymentPlanIds = [];
//         venue.dataValues.paymentPlanId = [];
//       }
//     } else {
//       paymentPlanIds = venue.paymentPlanId || [];
//     }

//     // ✅ Fetch PaymentPlans
//     venue.dataValues.paymentPlans = paymentPlanIds.length
//       ? await PaymentPlan.findAll({ where: { id: paymentPlanIds } })
//       : [];

//     // ✅ Parse termGroupId
//     let termGroupIds = [];
//     if (typeof venue.termGroupId === "string") {
//       try {
//         termGroupIds = JSON.parse(venue.termGroupId);
//       } catch {
//         termGroupIds = [];
//       }
//     } else if (Array.isArray(venue.termGroupId)) {
//       termGroupIds = venue.termGroupId;
//     }

//     // ✅ Fetch and enrich term groups
//     if (termGroupIds.length > 0) {
//       const termGroups = await TermGroup.findAll({
//         where: { id: termGroupIds },
//         include: [
//           {
//             model: Term,
//             as: "terms",
//             attributes: [
//               "id",
//               "termGroupId",
//               "termName",
//               "startDate",
//               "endDate",
//               "exclusionDates",
//               "totalSessions",
//               "sessionsMap",
//             ],
//           },
//         ],
//       });

//       for (const termGroup of termGroups) {
//         for (const term of termGroup.terms || []) {
//           // ✅ Parse exclusionDates
//           if (typeof term.exclusionDates === "string") {
//             try {
//               term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
//             } catch {
//               term.dataValues.exclusionDates = [];
//             }
//           }

//           // ✅ Parse and enrich sessionsMap
//           let parsedSessionsMap = [];
//           if (typeof term.sessionsMap === "string") {
//             try {
//               parsedSessionsMap = JSON.parse(term.sessionsMap);
//             } catch {
//               parsedSessionsMap = [];
//             }
//           } else {
//             parsedSessionsMap = term.sessionsMap || [];
//           }

//           // ✅ Enrich each entry with sessionPlan
//           for (let i = 0; i < parsedSessionsMap.length; i++) {
//             const entry = parsedSessionsMap[i];
//             if (!entry.sessionPlanId) continue;

//             const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
//               attributes: [
//                 "id",
//                 "groupName",
//                 "levels",
//                 "video",
//                 "banner",
//                 "player",
//               ],
//             });

//             if (spg) {
//               await parseSessionPlanGroupLevels(spg); // ✅ includes sessionExercises
//               entry.sessionPlan = spg;
//             } else {
//               entry.sessionPlan = null;
//             }
//           }

//           term.dataValues.sessionsMap = parsedSessionsMap;
//         }
//       }

//       venue.dataValues.termGroups = termGroups;
//     } else {
//       venue.dataValues.termGroups = [];
//     }

//     return {
//       status: true,
//       message: "Venue fetched successfully.",
//       data: venue,
//     };
//   } catch (error) {
//     console.error("❌ getVenueById Error:", error.message);
//     return {
//       status: false,
//       message: "Failed to fetch venue.",
//     };
//   }
// };

// 🔹 Update Venue

exports.getVenueById = async (id, createdBy) => {
  try {
    console.log("🔍 Fetching venue by ID:", id);

    const venue = await Venue.findOne({
      where: { id, createdBy }, // ✅ Scope to admin
      attributes: [
        "id",
        "area",
        "name",
        "address",
        "facility",
        "parkingNote",
        "howToEnterFacility",
        "paymentGroupId", // ✅ only this now
        "isCongested",
        "hasParking",
        "termGroupId",
        "latitude",
        "longitude",
        "postal_code",
        "createdBy",
        "createdAt",
        "updatedAt",
      ],
    });

    if (!venue) {
      console.warn("❌ Venue not found or unauthorized.");
      return { status: false, message: "Venue not found." };
    }

    // ✅ Parse paymentGroupId
    let paymentGroupIds = [];
    if (typeof venue.paymentGroupId === "string") {
      try {
        paymentGroupIds = JSON.parse(venue.paymentGroupId);
        venue.dataValues.paymentGroupId = paymentGroupIds;
      } catch {
        paymentGroupIds = [];
        venue.dataValues.paymentGroupId = [];
      }
    } else {
      paymentGroupIds = venue.paymentGroupId || [];
    }

    // ✅ Fetch PaymentGroups with PaymentPlans
    let paymentGroups = [];
    if (paymentGroupIds.length > 0) {
      paymentGroups = await PaymentGroup.findAll({
        where: { id: paymentGroupIds },
        include: [
          {
            model: PaymentPlan,
            as: "paymentPlans", // must match association alias in PaymentGroup model
            attributes: [
              "id",
              "title",
              "price",
              "priceLesson",
              "interval",
              "duration",
              "students",
              "joiningFee",
              "HolidayCampPackage",
              "termsAndCondition",
              "createdBy",
              "createdAt",
              "updatedAt",
            ],
          },
        ],
      });
    }
    venue.dataValues.paymentGroups = paymentGroups;

    // ✅ Parse termGroupId
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

    // ✅ Fetch and enrich term groups
    if (termGroupIds.length > 0) {
      const termGroups = await TermGroup.findAll({
        where: { id: termGroupIds },
        include: [
          {
            model: Term,
            as: "terms",
            attributes: [
              "id",
              "termGroupId",
              "termName",
              "startDate",
              "endDate",
              "exclusionDates",
              "totalSessions",
              "sessionsMap",
            ],
          },
        ],
      });

      for (const termGroup of termGroups) {
        for (const term of termGroup.terms || []) {
          // ✅ Parse exclusionDates
          if (typeof term.exclusionDates === "string") {
            try {
              term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
            } catch {
              term.dataValues.exclusionDates = [];
            }
          }

          // ✅ Parse and enrich sessionsMap
          let parsedSessionsMap = [];
          if (typeof term.sessionsMap === "string") {
            try {
              parsedSessionsMap = JSON.parse(term.sessionsMap);
            } catch {
              parsedSessionsMap = [];
            }
          } else {
            parsedSessionsMap = term.sessionsMap || [];
          }

          // ✅ Enrich each entry with sessionPlan
          for (let i = 0; i < parsedSessionsMap.length; i++) {
            const entry = parsedSessionsMap[i];
            if (!entry.sessionPlanId) continue;

            const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: [
                "id",
                "groupName",
                "levels",
                "video",
                "banner",
                "player",
              ],
            });

            if (spg) {
              await parseSessionPlanGroupLevels(spg); // ✅ includes sessionExercises
              entry.sessionPlan = spg;
            } else {
              entry.sessionPlan = null;
            }
          }

          term.dataValues.sessionsMap = parsedSessionsMap;
        }
      }

      venue.dataValues.termGroups = termGroups;
    } else {
      venue.dataValues.termGroups = [];
    }

    return {
      status: true,
      message: "Venue fetched successfully.",
      data: venue,
    };
  } catch (error) {
    console.error("❌ getVenueById Error:", error.message);
    return {
      status: false,
      message: "Failed to fetch venue.",
    };
  }
};

exports.updateVenue = async (id, data) => {
  try {
    const venue = await Venue.findByPk(id);
    if (!venue) {
      return { status: false, message: "Venue not found." };
    }

    // ✅ Parse and sanitize incoming IDs
    if (typeof data.termGroupId === "string") {
      data.termGroupId = data.termGroupId
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
    }

    if (typeof data.paymentGroupId === "string") {
      data.paymentGroupId = data.paymentGroupId
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
    }

    // ✅ Convert arrays to JSON string before saving
    if (Array.isArray(data.termGroupId)) {
      data.termGroupId = JSON.stringify(data.termGroupId);
    }

    if (Array.isArray(data.paymentGroupId)) {
      data.paymentGroupId = JSON.stringify(data.paymentGroupId);
    }

    // ✅ Re-geocode if address or area changed
    if (data.address || data.area) {
      const coords = await geocodeAddress(
        data.address || venue.address,
        data.area || venue.area
      );
      if (coords) {
        data.latitude = coords.latitude;
        data.longitude = coords.longitude;
        data.postal_code = coords.postal_code;
      }
    }

    // ✅ Update venue
    await venue.update(data);

    // ✅ Re-fetch updated venue
    const updatedVenue = await Venue.findByPk(id);

    // ✅ Payment Groups & nested PaymentPlans
    const paymentGroupIds =
      typeof updatedVenue.paymentGroupId === "string"
        ? JSON.parse(updatedVenue.paymentGroupId || "[]")
        : Array.isArray(updatedVenue.paymentGroupId)
        ? updatedVenue.paymentGroupId
        : [];

    let paymentGroups = [];
    if (paymentGroupIds.length > 0) {
      paymentGroups = await PaymentGroup.findAll({
        where: { id: paymentGroupIds },
        include: [{ model: PaymentPlan, as: "paymentPlans" }],
      });
    }
    updatedVenue.dataValues.paymentGroups = paymentGroups;

    // ✅ Term Groups & nested Terms
    const termGroupIds =
      typeof updatedVenue.termGroupId === "string"
        ? JSON.parse(updatedVenue.termGroupId || "[]")
        : Array.isArray(updatedVenue.termGroupId)
        ? updatedVenue.termGroupId
        : [];

    if (termGroupIds.length > 0) {
      const termGroups = await TermGroup.findAll({
        where: { id: termGroupIds },
        include: [
          {
            model: Term,
            as: "terms",
            attributes: [
              "id",
              "termGroupId",
              "termName",
              "startDate",
              "endDate",
              "exclusionDates",
              "totalSessions",
              "sessionsMap",
            ],
          },
        ],
      });

      for (const termGroup of termGroups) {
        for (const term of termGroup.terms || []) {
          // Parse exclusionDates
          if (typeof term.exclusionDates === "string") {
            try {
              term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
            } catch {
              term.dataValues.exclusionDates = [];
            }
          }

          // Parse and enrich sessionsMap
          let parsedSessionsMap = [];
          if (typeof term.sessionsMap === "string") {
            try {
              parsedSessionsMap = JSON.parse(term.sessionsMap);
            } catch {
              parsedSessionsMap = [];
            }
          } else {
            parsedSessionsMap = term.sessionsMap || [];
          }

          for (const entry of parsedSessionsMap) {
            if (!entry.sessionPlanId) continue;

            const spg = await SessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: ["id", "groupName", "levels", "video", "banner", "player"],
            });

            if (spg) {
              await parseSessionPlanGroupLevels(spg); // enrich levels & exercises
              entry.sessionPlan = spg;
            } else {
              entry.sessionPlan = null;
            }
          }

          term.dataValues.sessionsMap = parsedSessionsMap;
        }
      }

      updatedVenue.dataValues.termGroups = termGroups;
    } else {
      updatedVenue.dataValues.termGroups = [];
    }

    return {
      status: true,
      message: "Venue updated successfully.",
      data: updatedVenue,
    };
  } catch (error) {
    console.error("❌ updateVenue Error:", error.message);
    return { status: false, message: "Update failed. " + error.message };
  }
};

// 🔹 Delete
exports.deleteVenue = async (id) => {
  try {
    // First, find the venue
    const venue = await Venue.findOne({ where: { id } });
    if (!venue) {
      return { status: false, message: "Venue not found." };
    }

    // Delete it
    await Venue.destroy({ where: { id } });

    return { status: true, name: venue.name }; // ✅ return name
  } catch (error) {
    return { status: false, message: error.message };
  }
};
