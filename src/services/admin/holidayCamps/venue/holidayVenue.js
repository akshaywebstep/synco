const {
  HolidayVenue,
  HolidayTerm,
  HolidayTermGroup,
  HolidaySessionPlanGroup,
  HolidaySessionExercise,
  HolidayPaymentPlan,
  HolidayPaymentGroup,
  // PaymentGroupHasPlan,
} = require("../../../../models");
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
    ? await HolidaySessionExercise.findAll({
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

exports.createHolidayVenue = async (data) => {
  try {
    // ✅ termGroupId → allow multiple IDs (array)
    if (typeof data.termGroupId === "string") {
      data.termGroupId = data.termGroupId
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
    }
    if (!Array.isArray(data.termGroupId) || data.termGroupId.length === 0) {
      throw new Error("Invalid termGroupId");
    }
    data.termGroupId = JSON.stringify(data.termGroupId); // store as JSON string

    // ✅ paymentGroupId → single integer
    if (typeof data.paymentGroupId === "string") {
      data.paymentGroupId = parseInt(data.paymentGroupId.trim());
    }
    if (isNaN(data.paymentGroupId)) {
      throw new Error("Payment group is required");
    }

    // ✅ Geocode address
    const coords = await geocodeAddress(data.address, data.area);
    if (!coords) {
      throw new Error("Your address is incorrect. Please provide a valid address.");
    }

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
    const venue = await HolidayVenue.create(data);

    // Refetch to enrich
    const createdVenue = await HolidayVenue.findByPk(venue.id);

    // =====================
    // Payment Group (single) + nested PaymentPlans
    // =====================
    let paymentGroup = null;
    if (createdVenue.paymentGroupId) {
      paymentGroup = await HolidayPaymentGroup.findByPk(createdVenue.paymentGroupId, {
        include: [{ model: HolidayPaymentPlan, as: "holidayPaymentPlans" }],
      });
    }
    createdVenue.dataValues.paymentGroup = paymentGroup;

    // =====================
    // Term Groups → fetch TermGroup + Terms + sessions
    // =====================
    let termGroupIds = [];
    if (typeof createdVenue.termGroupId === "string") {
      try {
        termGroupIds = JSON.parse(createdVenue.termGroupId);
      } catch {
        termGroupIds = [];
      }
    }
    // 
    if (termGroupIds.length > 0) {
      const termGroups = await HolidayTermGroup.findAll({
        where: { id: termGroupIds },
        include: [
          {
            model: HolidayTerm,
            as: "holidayTerms",
            attributes: [
              "id",
              "termGroupId",
              "termName",
              "day",
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
        for (const term of termGroup.holidayTerms || []) {
          // Parse exclusionDates
          if (typeof term.exclusionDates === "string") {
            try {
              term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
            } catch {
              term.dataValues.exclusionDates = [];
            }
          }

          // Parse & enrich sessionsMap
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

            const spg = await HolidaySessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: [
                "id",
                "groupName",
                "levels",
                "beginner_video",
                "intermediate_video",
                "advanced_video",
                "pro_video",
                "banner",
                "player",
                "beginner_upload",
                "intermediate_upload",
                "pro_upload",
                "advanced_upload",
              ],
            });

            if (spg) {
              await parseSessionPlanGroupLevels(spg);
              entry.sessionPlan = spg;
            } else {
              entry.sessionPlan = null;
            }
          }

          term.dataValues.sessionsMap = parsedSessionsMap;
        }
      }

      createdVenue.dataValues.termGroups = termGroups;
    } else {
      createdVenue.dataValues.termGroups = [];
    }

    return { status: true, data: createdVenue };
  } catch (error) {
    console.error("❌ Venue create error:", error.message);
    return { status: false, message: error.message };
  }
};
// =====================
exports.updateHolidayVenue = async (id, data) => {
  try {
    const venue = await HolidayVenue.findByPk(id);
    if (!venue) {
      return { status: false, message: "Venue not found." };
    }

    // ✅ Handle termGroupId (multiple)
    if ("termGroupId" in data) {
      if (typeof data.termGroupId === "string") {
        data.termGroupId = data.termGroupId
          .split(",")
          .map((id) => parseInt(id.trim()))
          .filter((id) => !isNaN(id));
      }

      if (Array.isArray(data.termGroupId)) {
        data.termGroupId = JSON.stringify(data.termGroupId);
      }
    } else {
      delete data.termGroupId;
    }

    // ✅ Handle paymentGroupId (single)
    if ("paymentGroupId" in data) {
      if (typeof data.paymentGroupId === "string") {
        const parsed = parseInt(data.paymentGroupId.trim());
        if (!isNaN(parsed)) {
          data.paymentGroupId = parsed;
        } else {
          throw new Error("Payment group is required");
        }
      }
    } else {
      delete data.paymentGroupId;
    }

    // ✅ Re-geocode if address/area changed
    if (
      (data.address && data.address !== venue.address) ||
      (data.area && data.area !== venue.area)
    ) {
      const coords = await geocodeAddress(
        data.address || venue.address,
        data.area || venue.area
      );

      if (!coords) {
        throw new Error("Your address is incorrect. Please provide a valid address.");
      }

      if (coords) {
        data.latitude = coords.latitude;
        data.longitude = coords.longitude;
        data.postal_code = coords.postal_code;
      }
    }

    // ✅ Clean undefined values
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    // ✅ Update
    await venue.update(data);
    const updatedVenue = await HolidayVenue.findByPk(id);

    // ✅ Payment Group
    let paymentGroup = null;
    if (updatedVenue.paymentGroupId) {
      paymentGroup = await HolidayPaymentGroup.findByPk(updatedVenue.paymentGroupId, {
        include: [{ model: HolidayPaymentPlan, as: "holidayPaymentPlans" }],
      });
    }
    updatedVenue.dataValues.paymentGroup = paymentGroup;

    // ✅ Term Groups (same as create)
    let termGroupIds = [];
    if (typeof updatedVenue.termGroupId === "string") {
      try {
        termGroupIds = JSON.parse(updatedVenue.termGroupId);
      } catch {
        termGroupIds = [];
      }
    }

    if (termGroupIds.length > 0) {
      const termGroups = await HolidayTermGroup.findAll({
        where: { id: termGroupIds },
        include: [
          {
            model: HolidayTerm,
            as: "holidayTerms",
            attributes: [
              "id",
              "termGroupId",
              "termName",
              "day",
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
        for (const term of termGroup.holidayTerms || []) {
          if (typeof term.exclusionDates === "string") {
            try {
              term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
            } catch {
              term.dataValues.exclusionDates = [];
            }
          }

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

            const spg = await HolidaySessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: [
                "id",
                "groupName",
                // "pinned",
                "levels",
                "beginner_video",
                "intermediate_video",
                "pro_video",
                "advanced_video",
                "banner",
                "player",
                "beginner_upload",
                "intermediate_upload",
                "pro_upload",
                "advanced_upload",
              ],
            });

            if (spg) {
              await parseSessionPlanGroupLevels(spg);
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

exports.getAllHolidayVenues = async (createdBy) => {
  try {
    if (!createdBy || isNaN(Number(createdBy))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const venues = await HolidayVenue.findAll({
      where: { createdBy: Number(createdBy) },
      order: [["createdAt", "DESC"]],
      attributes: [
        "id",
        "area",
        "name",
        "address",
        "facility",
        "parkingNote",
        "howToEnterFacility",
        "paymentGroupId",
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

    // ===============================================================
    // LOOP: ENRICH EACH VENUE
    // ===============================================================
    for (const venue of venues) {
      // ===================== PAYMENT GROUPS =====================
      const paymentGroupId = venue.paymentGroupId;

      let paymentGroups = [];
      if (paymentGroupId) {
        paymentGroups = await HolidayPaymentGroup.findAll({
          where: { id: paymentGroupId },
          include: [
            {
              model: HolidayPaymentPlan,
              as: "holidayPaymentPlans",
              attributes: [
                "id",
                "title",
                "price",
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

      venue.dataValues.paymentGroups = paymentGroups;

      // ===================== TERM GROUPS =====================
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

      if (termGroupIds.length > 0) {
        const termGroups = await HolidayTermGroup.findAll({
          where: { id: termGroupIds },
          include: [
            {
              model: HolidayTerm,
              as: "holidayTerms",
              attributes: [
                "id",
                "termGroupId",
                "termName",
                "day",
                "startDate",
                "endDate",
                "exclusionDates",
                "totalSessions",
                "sessionsMap",
              ],
            },
          ],
        });

        // ===================== PROCESS EACH TERM =====================
        for (const termGroup of termGroups) {
          if (termGroup?.holidayTerms?.length) {
            for (const term of termGroup.holidayTerms) {

              // --- Parse exclusionDates ---
              if (typeof term.exclusionDates === "string") {
                try {
                  term.dataValues.exclusionDates = JSON.parse(term.exclusionDates);
                } catch {
                  term.dataValues.exclusionDates = [];
                }
              }

              // --- Parse sessionsMap ---
              let parsedSessionsMap = [];
              if (typeof term.sessionsMap === "string") {
                try {
                  parsedSessionsMap = JSON.parse(term.sessionsMap);
                } catch {
                  parsedSessionsMap = [];
                }
              }

              // --- Enrich sessions ---
              for (let i = 0; i < parsedSessionsMap.length; i++) {
                const entry = parsedSessionsMap[i];

                if (!entry.sessionPlanId) continue;

                const spg = await HolidaySessionPlanGroup.findByPk(
                  entry.sessionPlanId,
                  {
                    attributes: [
                      "id",
                      "groupName",
                      "levels",
                      "beginner_video",
                      "intermediate_video",
                      "pro_video",
                      "advanced_video",
                      "banner",
                      "player",
                      "beginner_upload",
                      "intermediate_upload",
                      "pro_upload",
                      "advanced_upload",
                      "type",
                      "pinned",
                    ],
                  }
                );

                if (spg) {
                  await parseSessionPlanGroupLevels(spg);
                  entry.sessionPlan = spg;
                } else {
                  entry.sessionPlan = null;
                }
              }

              term.dataValues.sessionsMap = parsedSessionsMap;
            }
          }
        }

        venue.dataValues.termGroups = termGroups;
      } else {
        venue.dataValues.termGroups = [];
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

exports.getHolidayVenueById = async (id, createdBy) => {
  try {
    if (!createdBy || isNaN(Number(createdBy))) {
      return {
        status: false,
        message: "No valid parent or super admin found for this request.",
        data: [],
      };
    }

    const venue = await HolidayVenue.findOne({
      // where: { id },
      where: { id, createdBy: Number(createdBy) },
      attributes: [
        "id",
        "area",
        "name",
        "address",
        "facility",
        "parkingNote",
        "howToEnterFacility",
        "paymentGroupId", // single integer now
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

    // =====================
    // paymentGroupId → single integer
    // =====================
    let paymentGroups = [];
    if (venue.paymentGroupId) {
      const pg = await HolidayPaymentGroup.findAll({
        where: { id: venue.paymentGroupId },
        include: [
          {
            model: HolidayPaymentPlan,
            as: "holidayPaymentPlans",
            attributes: [
              "id",
              "title",
              "price",
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
      paymentGroups = pg;
    }
    venue.dataValues.paymentGroups = paymentGroups;

    // =====================
    // termGroupId → array of IDs
    // =====================
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

    // =====================
    // Fetch and enrich term groups
    // =====================
    if (termGroupIds.length > 0) {
      const termGroups = await HolidayTermGroup.findAll({
        where: { id: termGroupIds },
        include: [
          {
            model: HolidayTerm,
            as: "holidayTerms",
            attributes: [
              "id",
              "termGroupId",
              "termName",
              "day",
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
        for (const term of termGroup.holidayTerms || []) {
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

          for (let i = 0; i < parsedSessionsMap.length; i++) {
            const entry = parsedSessionsMap[i];
            if (!entry.sessionPlanId) continue;

            const spg = await HolidaySessionPlanGroup.findByPk(entry.sessionPlanId, {
              attributes: ["id", "groupName", "levels", "beginner_video",
                "intermediate_video",
                "advanced_video",
                "pro_video", "banner", "beginner_upload",
                "intermediate_upload",
                "pro_upload",
                "advanced_upload", "player", "type", "pinned", "createdBy", "createdAt"],
            });

            if (spg) {
              // Parse levels safely
              let levels = {};
              try {
                levels = typeof spg.levels === "string" ? JSON.parse(spg.levels) : spg.levels || {};
              } catch {
                levels = {};
              }

              // Fetch all exercises for this creator
              const allExercises = await HolidaySessionExercise.findAll({
                where: { createdBy: spg.createdBy },
              });

              const exerciseMap = allExercises.reduce((acc, ex) => {
                acc[ex.id] = ex;
                return acc;
              }, {});

              // Enrich each level item with sessionExercises
              for (const levelKey of Object.keys(levels)) {
                for (const item of levels[levelKey]) {
                  if (Array.isArray(item.sessionExerciseId)) {
                    item.sessionExercises = item.sessionExerciseId
                      .map((exId) => exerciseMap[exId])
                      .filter(Boolean)
                      .map((ex) => ({
                        id: ex.id,
                        title: ex.title,
                        description: ex.description,
                        duration: ex.duration,
                      }));
                  } else {
                    item.sessionExercises = [];
                  }
                }
              }

              // Calculate how long ago the video was uploaded
              let videoUploadedAgo = null;
              if (spg.video) {
                const now = new Date();
                const created = new Date(spg.createdAt);
                const diffMs = now - created;
                const diffSeconds = Math.floor(diffMs / 1000);
                const diffMinutes = Math.floor(diffSeconds / 60);
                const diffHours = Math.floor(diffMinutes / 60);
                const diffDays = Math.floor(diffHours / 24);

                if (diffDays > 0) videoUploadedAgo = `${diffDays} day(s) ago`;
                else if (diffHours > 0) videoUploadedAgo = `${diffHours} hour(s) ago`;
                else if (diffMinutes > 0) videoUploadedAgo = `${diffMinutes} minute(s) ago`;
                else videoUploadedAgo = `${diffSeconds} second(s) ago`;
              }

              // Assign enriched sessionPlan without changing other fields
              entry.sessionPlan = {
                id: spg.id,
                groupName: spg.groupName,
                // pinned: spg.pinned,
                levels,
                video: spg.video,
                banner: spg.banner,
                player: spg.player,
                videoUploadedAgo,
              };
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

exports.deleteHolidayVenue = async (id, deletedBy) => {
  try {
    // Find the venue (not already deleted)
    const venue = await HolidayVenue.findOne({
      where: { id, deletedAt: null },
    });

    if (!venue) {
      return { status: false, message: "Venue not found." };
    }

    // Track who deleted
    await venue.update({ deletedBy });

    // Soft delete (paranoid mode automatically sets deletedAt)
    await venue.destroy();

    return { status: true, name: venue.name };
  } catch (error) {
    console.error("❌ deleteVenue Service Error:", error);
    return { status: false, message: `Failed to delete venue. ${error.message}` };
  }
};
