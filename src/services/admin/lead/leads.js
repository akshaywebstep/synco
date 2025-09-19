const { Lead, Venue, Admin, ClassSchedule } = require("../../../models");
const axios = require("axios");
const { Op } = require("sequelize");

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

// Get nearest venues given a latitude/longitude
async function getNearestVenuesByCoordinates(lat, lng, limit = 5) {
  const venues = await Venue.findAll();
  const venuesWithDistance = venues.map((venue) => ({
    ...venue.dataValues,
    distance: calculateDistance(lat, lng, venue.latitude, venue.longitude),
  }));
  venuesWithDistance.sort((a, b) => a.distance - b.distance);
  return venuesWithDistance.slice(0, limit);
}

// Get all venues with distance from a latitude/longitude
async function getAllVenuesByCoordinates(lat, lng) {
  const venues = await Venue.findAll();
  const venuesWithDistance = venues.map((venue) => ({
    ...venue.dataValues,
    distance: calculateDistance(lat, lng, venue.latitude, venue.longitude),
  }));
  venuesWithDistance.sort((a, b) => a.distance - b.distance);
  return venuesWithDistance;
}

// -------------------- Lead Services -------------------- //

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
exports.getAllLeads = async (filters = {}) => {
  try {
    // Fetch all leads (unfiltered)
    const allLeads = await Lead.findAll({
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Admin,
          as: "assignedAgent",
          attributes: ["id", "firstName", "lastName", "email", "roleId"],
        },
      ],
    });

    // Compute analytics always on ALL leads
    const analytics = {
      totalLeads: {
        count: allLeads.length,
        conversion: allLeads.length ? "100%" : "0%",
      },
      newLeads: {
        count: allLeads.filter((l) => l.status === "new").length,
        conversion: allLeads.length
          ? `${(
              (allLeads.filter((l) => l.status === "new").length /
                allLeads.length) *
              100
            ).toFixed(2)}%`
          : "0%",
      },
      leadsToTrials: {
        count: allLeads.filter((l) => l.status === "trial").length,
        conversion: allLeads.length
          ? `${(
              (allLeads.filter((l) => l.status === "trial").length /
                allLeads.length) *
              100
            ).toFixed(2)}%`
          : "0%",
      },
      leadsToSales: {
        count: allLeads.filter((l) => l.status === "sale").length,
        conversion: allLeads.length
          ? `${(
              (allLeads.filter((l) => l.status === "sale").length /
                allLeads.length) *
              100
            ).toFixed(2)}%`
          : "0%",
      },
    };

    // ✅ Apply fromDate / toDate filter if provided
    let filteredLeads = allLeads;
    // ✅ Apply fromDate / toDate filter if provided
    if (filters.fromDate || filters.toDate) {
      const fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
      let toDate = filters.toDate ? new Date(filters.toDate) : null;

      // ⏩ Fix: extend to end of day
      if (toDate) {
        toDate.setHours(23, 59, 59, 999);
      }

      filteredLeads = filteredLeads.filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        return (
          (!fromDate || createdAt >= fromDate) &&
          (!toDate || createdAt <= toDate)
        );
      });

      if (filteredLeads.length === 0) {
        return {
          status: true,
          message: "No leads found in the selected date range",
          data: [],
          allVenues: [],
          analytics,
        };
      }
    }
    // Filter by name
    if (filters.name) {
      const nameParts = filters.name.trim().split(" ");
      filteredLeads = filteredLeads.filter(
        (l) =>
          l.firstName.toLowerCase().includes(nameParts[0].toLowerCase()) ||
          l.lastName
            .toLowerCase()
            .includes((nameParts[1] || nameParts[0]).toLowerCase())
      );
    }

    // ✅ Filter by status (new, trial, sale, others)
    if (filters.status) {
      filteredLeads = filteredLeads.filter(
        (lead) => lead.status === filters.status
      );

      if (!filteredLeads.length) {
        return {
          status: true,
          message: `No leads found for status "${filters.status}"`,
          data: [],
          allVenues: [],
          analytics,
        };
      }
    }

    // Filter by name
    if (filters.name) {
      const nameParts = filters.name.trim().split(" ");
      filteredLeads = filteredLeads.filter(
        (l) =>
          l.firstName.toLowerCase().includes(nameParts[0].toLowerCase()) ||
          l.lastName
            .toLowerCase()
            .includes((nameParts[1] || nameParts[0]).toLowerCase())
      );
    }

    // Fetch all venues
    let allVenuesList = await Venue.findAll();

    // Filter venues by name
    if (filters.venueName) {
      const nameLower = filters.venueName.toLowerCase();
      allVenuesList = allVenuesList.filter((v) =>
        v.name.toLowerCase().includes(nameLower)
      );

      if (!allVenuesList.length) {
        return {
          status: true,
          message: "No leads found for this venue filter",
          data: [],
          allVenues: [],
          analytics,
        };
      }
    }

    const allVenues = allVenuesList.map((v) => ({ ...v.dataValues }));

    // Attach nearestVenues
    const leadsWithNearestVenues = await Promise.all(
      filteredLeads.map(async (lead) => {
        let nearestVenues = [];
        if (lead.postcode && allVenuesList.length > 0) {
          const coords = await getCoordinatesFromPostcode(lead.postcode);
          if (coords) {
            // Calculate distances
            nearestVenues = await Promise.all(
              allVenuesList
                .map((v) => ({
                  ...v.dataValues,
                  distance: calculateDistance(
                    coords.latitude,
                    coords.longitude,
                    v.latitude,
                    v.longitude
                  ),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
                .map(async (venue) => {
                  // 🔑 Fetch class schedules for each venue
                  const classSchedules = await ClassSchedule.findAll({
                    where: { venueId: venue.id },
                  });

                  return {
                    ...venue,
                    classSchedules: classSchedules.map((cs) => cs.dataValues),
                  };
                })
            );
          }
        }
        return { ...lead.dataValues, nearestVenues };
      })
    );

    // If venue filter applied, remove leads with no nearestVenues
    const filteredByVenues = filters.venueName
      ? leadsWithNearestVenues.filter((l) => l.nearestVenues.length > 0)
      : leadsWithNearestVenues;

    return {
      status: true,
      message: "Leads with nearest venues retrieved",
      data: filteredByVenues,
      allVenues,
      analytics,
    };
  } catch (error) {
    console.error("❌ getAllLeads Error:", error.message);
    return { status: false, message: error.message };
  }
};
