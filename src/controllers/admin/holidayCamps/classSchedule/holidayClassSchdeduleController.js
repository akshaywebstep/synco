const { validateFormData } = require("../../../../utils/validateFormData");
const ClassScheduleService = require("../../../../services/admin/holidayCamps/classSchedule/holidayClassSchedule");
const TermService = require("../../../../services/admin/holidayCamps/termAndDates/holidayTerm");
const { logActivity } = require("../../../../utils/admin/activityLogger");
const {
    getVideoDurationInSeconds,
    formatDuration,
} = require("../../../../utils/videoHelper");
const { Op } = require("sequelize");
const { HolidayVenue,
    HolidayTermGroup,
    HolidayTerm,
    HolidayClassSchedule,
    HolidayClassScheduleTermMap, } = require("../../../../models");
const { getMainSuperAdminOfAdmin } = require("../../../../utils/auth");

const {
    createNotification,
} = require("../../../../utils/admin/notificationHelper");

const DEBUG = process.env.DEBUG === "true";
const PANEL = "admin";
const MODULE = "holiday-class-schedule";

function timeToMinutes(time) {
    const [timePart, period] = time.split(" "); // e.g., "10:30 AM"
    let [hours, minutes] = timePart.split(":").map(Number);

    if (period.toUpperCase() === "PM" && hours !== 12) hours += 12;
    if (period.toUpperCase() === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

exports.createHolidayClassSchedule = async (req, res) => {
    const {
        className,
        capacity,
        day,
        startTime,
        endTime,
        allowFreeTrial,
        facility,
        venueId,
    } = req.body;

    const createdBy = req.admin?.id; // ✅ Securely taken from logged-in admin

    if (DEBUG) {
        console.log("📥 Creating new class schedule:", req.body);
    }

    // ✅ Validation
    const validation = validateFormData(req.body, {
        requiredFields: ["className", "day", "startTime", "endTime", "venueId"],
    });

    if (!validation.isValid) {
        if (DEBUG) console.log("❌ Validation failed:", validation.error);
        await logActivity(req, PANEL, MODULE, "create", validation.error, false);
        return res.status(400).json({ status: false, ...validation });
    }

    // ✅ Ensure startTime < endTime
    if (timeToMinutes(startTime) > timeToMinutes(endTime)) {
        if (DEBUG) console.log("❌ Start time must be before end time");
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { message: "Start time must be before end time" },
            false
        );
        return res.status(400).json({
            status: false,
            message: "Start time must be before end time.",
        });
    }

    // ✅ Check if venue exists
    const venue = await HolidayVenue.findByPk(venueId);
    if (!venue) {
        if (DEBUG) console.log("❌ Venue not found:", venueId);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { message: "Venue not found" },
            false
        );
        return res.status(404).json({
            status: false,
            message: "Invalid venue selected. Venue does not exist.",
        });
    }
    console.log("venue.termGroupId:", venue.termGroupId);
    const termGroupIds = JSON.parse(venue.termGroupId || "[]").map(Number);
    console.log("Parsed termGroupIds:", termGroupIds);

    const termsRes = await TermService.getTermsByTermGroupId(termGroupIds);
    console.log("termsRes:", termsRes);
    const termIds = (termsRes.data || []).map((t) => t.id);
    const termIdsString = JSON.stringify(termIds);

    try {
        const result = await ClassScheduleService.createHolidayClass({
            className,
            capacity,
            totalCapacity: capacity,
            day,
            startTime,
            endTime,
            allowFreeTrial,
            facility,
            venueId,
            termIds: termIdsString,
            createdBy,
        });

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Creation failed:", result.message);
            await logActivity(req, PANEL, MODULE, "create", result, false);
            return res.status(500).json({ status: false, message: result.message });
        }

        const newClass = result.data;

        // ✅ Create mappings in ClassScheduleTermMap with status "pending"
        try {
            let termGroupIds = [];

            if (venue.termGroupId) {
                if (typeof venue.termGroupId === "string") {
                    try {
                        termGroupIds = JSON.parse(venue.termGroupId); // JSON array
                    } catch {
                        termGroupIds = venue.termGroupId
                            .split(",")
                            .map((id) => Number(id.trim()))
                            .filter(Boolean); // comma-separated fallback
                    }
                } else if (Array.isArray(venue.termGroupId)) {
                    termGroupIds = venue.termGroupId;
                } else {
                    termGroupIds = [venue.termGroupId]; // single number fallback
                }
            }

            if (DEBUG) console.log("👉 termGroupIds resolved:", termGroupIds);

            if (termGroupIds.length > 0) {
                const termGroups = await HolidayTermGroup.findAll({
                    where: { id: termGroupIds },
                });

                if (DEBUG)
                    console.log(
                        "👉 Loaded termGroups:",
                        termGroups.map((tg) => tg.id)
                    );

                for (const termGroup of termGroups) {
                    const terms = await HolidayTerm.findAll({
                        where: { termGroupId: termGroup.id },
                    });

                    if (DEBUG)
                        console.log(
                            `👉 Processing termGroup ${termGroup.id}, terms:`,
                            terms.map((t) => t.id)
                        );

                    for (const term of terms) {
                        let sessionsMap = [];
                        try {
                            sessionsMap =
                                typeof term.sessionsMap === "string"
                                    ? JSON.parse(term.sessionsMap)
                                    : term.sessionsMap || [];
                        } catch (err) {
                            console.error(
                                "❌ Failed to parse sessionsMap for term:",
                                term.id,
                                err
                            );
                            continue;
                        }

                        if (DEBUG)
                            console.log(
                                `👉 Term ${term.id} sessionsMap:`,
                                JSON.stringify(sessionsMap)
                            );

                        for (const session of sessionsMap) {
                            if (session.sessionPlanId) {
                                await HolidayClassScheduleTermMap.create({
                                    classScheduleId: newClass.id,
                                    termGroupId: termGroup.id,
                                    termId: term.id,
                                    sessionPlanId: session.sessionPlanId,
                                    status: "pending", // ✅ default
                                    createdBy: createdBy,
                                });

                                if (DEBUG)
                                    console.log(
                                        `✅ Mapping created: classSchedule ${newClass.id} → term ${term.id} → sessionPlan ${session.sessionPlanId}`
                                    );
                            }
                        }
                    }
                }
            }
        } catch (mapError) {
            console.error(
                "⚠️ Failed to create ClassScheduleTermMap entries:",
                mapError
            );
        }

        if (DEBUG) console.log("✅ Class schedule created:", newClass);
        await logActivity(req, PANEL, MODULE, "create", result, true);

        await createNotification(
            req,
            "New Class Schedule Created",
            `Class "${className}" has been scheduled on ${day} from ${startTime} to ${endTime}.`,
            "System"
        );

        return res.status(201).json({
            status: true,
            message: "Class schedule created successfully.",
            data: newClass,
        });
    } catch (error) {
        console.error("❌ Server error during creation:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "create",
            { oneLineMessage: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ GET All Class Schedules
exports.getAllHolidayClassSchedules = async (req, res) => {
    if (DEBUG) console.log("📥 Fetching all class schedules...");

    try {
        const adminId = req.admin?.id;
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(req.admin.id);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? null;

        const result = await ClassScheduleService.getAllHolidayClasses(superAdminId); // ✅ pass admin ID

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Fetch failed:", result.message);
            await logActivity(req, PANEL, MODULE, "list", result, false);
            return res.status(500).json({ status: false, message: result.message });
        }

        if (DEBUG) console.table(result.data);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            { oneLineMessage: `Fetched ${result.data.length} class schedules.` },
            true
        );

        /*
        const getElapsedTime = (createdAt) => {
          const now = new Date();
          const created = new Date(createdAt);
          const diffMs = now - created;
          const diffSeconds = Math.floor(diffMs / 1000);
          const diffMinutes = Math.floor(diffSeconds / 60);
          const diffHours = Math.floor(diffMinutes / 60);
          const diffDays = Math.floor(diffHours / 24);
    
          if (diffDays > 0) return `${diffDays} day(s) ago`;
          if (diffHours > 0) return `${diffHours} hour(s) ago`;
          if (diffMinutes > 0) return `${diffMinutes} minute(s) ago`;
          return `${diffSeconds} second(s) ago`;
        };
    
        // Convert Sequelize instances to plain objects first
        const plainData = result.data.map(item => item.get({ plain: true }));
    
        const parsedLevels = [];
    
        for (const item of plainData) {
          const parsedTermGroups = [];
    
          if (item.venue?.termGroups) {
            for (const termGroup of item.venue.termGroups) {
              const parsedTerms = [];
    
              if (termGroup.terms) {
                for (const term of termGroup.terms) {
                  const parsedSessionsMap = [];
    
                  if (term.sessionsMap) {
                    for (const session of term.sessionsMap) {
    
                      const plainSession = session.get ? session.get({ plain: true }) : session;
    
                      const parsedSessionPlan = [];
    
                      if (plainSession.sessionPlan) {
                        // Make sure it's an array
                        const sessionPlans = Array.isArray(plainSession.sessionPlan)
                          ? plainSession.sessionPlan
                          : [plainSession.sessionPlan];
    
                        for (const plan of sessionPlans) {
    
                          // Video info processing
                          const videoInfo = {};
                          const levels = ["beginner", "intermediate", "advanced", "pro"];
    
                          for (const level of levels) {
                            const videoUrl = plan[`${level}_video`];
                            if (videoUrl) {
                              const durationSec = await getVideoDurationInSeconds(videoUrl);
                              const durationFormatted = formatDuration(durationSec);
                              const uploadedAgo = getElapsedTime(plan.createdAt);
    
                              videoInfo[`${level}_video_duration`] = durationFormatted;
                              videoInfo[`${level}_video_uploadedAgo`] = uploadedAgo;
                            } else {
                              videoInfo[`${level}_video_duration`] = null;
                              videoInfo[`${level}_video_uploadedAgo`] = null;
                            }
                          }
    
                          parsedSessionPlan.push({
                            ...plan,
                            ...videoInfo,
                          });
                        }
                      }
    
                      parsedSessionsMap.push({
                        ...plainSession,
                        sessionPlan: parsedSessionPlan,
                      });
                    }
                  }
    
                  parsedTerms.push({
                    ...term,
                    sessionsMap: parsedSessionsMap,
                  });
                }
              }
    
              parsedTermGroups.push({
                ...termGroup,
                terms: parsedTerms,
              });
            }
          }
    
          parsedLevels.push({
            ...item,
            venue: {
              ...item.venue,
              termGroups: parsedTermGroups,
            },
          });
        }
        */

        return res.status(200).json({
            status: true,
            message: "Fetched class schedules successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error fetching all class schedules:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "list",
            { oneLineMessage: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// ✅ GET Class Schedule by ID with Venue
exports.getHolidayClassScheduleDetails = async (req, res) => {
    const { id } = req.params; // Class ID
    const createdBy = req.admin?.id; // Current admin ID
    if (DEBUG) console.log(`🔍 Fetching class + venue for class ID: ${id}`);

    try {
        // ✅ Get the top-level super admin for this admin
        const mainSuperAdminResult = await getMainSuperAdminOfAdmin(createdBy);
        const superAdminId = mainSuperAdminResult?.superAdmin?.id ?? createdBy;

        // ✅ Pass both classId and superAdminId to the service
        const result = await ClassScheduleService.getHolidayClassByIdWithFullDetails(
            id,
            superAdminId
        );

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Not found:", result.message);
            return res.status(404).json({ status: false, message: result.message });
        }

        if (DEBUG) console.log("✅ Data fetched successfully");
        await logActivity(
            req,
            PANEL,
            MODULE,
            "getById",
            { oneLineMessage: `Fetched class schedule with ID: ${id}` },
            true
        );

        return res.status(200).json({
            status: true,
            message: "Class and venue fetched successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error fetching class schedule:", error);
        return res.status(500).json({ status: false, message: "Server error." });
    }
};

// exports.updateHolidayClassSchedule = async (req, res) => {
//     const { id } = req.params;
//     const adminId = req.admin?.id;

//     try {
//         // ✅ Validate venue
//         const venue = await HolidayVenue.findByPk(req.body.venueId);
//         if (!venue) {
//             return res.status(404).json({
//                 status: false,
//                 message: "Venue not found. Please select a valid venue.",
//             });
//         }

//         // ✅ Validate existing class
//         const existingClass = await HolidayClassSchedule.findByPk(id);
//         if (!existingClass) {
//             return res.status(404).json({
//                 status: false,
//                 message: "Class schedule not found.",
//             });
//         }

//         let updatedCapacity = existingClass.capacity;
//         let updatedTotalCapacity = existingClass.totalCapacity;

//         if (req.body.capacity !== undefined) {
//             const requestedCapacity = Number(req.body.capacity);

//             if (isNaN(requestedCapacity)) {
//                 return res.status(400).json({
//                     status: false,
//                     message: "Capacity must be a valid number.",
//                 });
//             }

//             if (requestedCapacity < 0) {
//                 return res.status(400).json({
//                     status: false,
//                     message: "Capacity cannot be negative.",
//                 });
//             }

//             // ✅ Check how many students are already booked
//             //   const bookedStudentsCount = await BookingStudentMeta.count({
//             //     include: [
//             //       {
//             //         model: Booking,
//             //         as: "booking",
//             //         where: {
//             //           classScheduleId: id,
//             //           status: { [Op.notIn]: ["cancelled", "removed"] },
//             //         },
//             //       },
//             //     ],
//             //   });

//             //   if (requestedCapacity < existingClass.capacity) {
//             //     // Decrease requested
//             //     if (requestedCapacity < bookedStudentsCount) {
//             //       return res.status(400).json({
//             //         status: false,
//             //         message: `Cannot decrease capacity below ${bookedStudentsCount} because that many students are already booked.`,
//             //       });
//             //     }
//             //     // Decrease capacity and totalCapacity by the same amount
//             //     const decreaseAmount = existingClass.capacity - requestedCapacity;
//             //     updatedCapacity = requestedCapacity;
//             //     updatedTotalCapacity = existingClass.totalCapacity - decreaseAmount;
//             //   } else if (requestedCapacity > existingClass.capacity) {
//             //     // Increase capacity (add-on)
//             //     const increaseAmount = requestedCapacity - existingClass.capacity;
//             //     updatedCapacity = existingClass.capacity + increaseAmount; // remaining capacity increases
//             //     updatedTotalCapacity = existingClass.totalCapacity + increaseAmount; // max capacity increases
//             //   }
//             // If requestedCapacity === existingClass.capacity → do nothing
//         }

//         // ✅ Perform the main update
//         const result = await ClassScheduleService.updateHolidayClass(id, {
//             ...req.body,
//             capacity: updatedCapacity,
//             totalCapacity: updatedTotalCapacity,
//             createdBy: adminId,
//         });

//         if (!result.status) {
//             return res.status(400).json({
//                 status: false,
//                 message: result.message || "Update failed.",
//             });
//         }

//         // ✅ Log the update activity
//         await logActivity(
//             req,
//             PANEL,
//             MODULE,
//             "update",
//             { oneLineMessage: `Updated class schedule with ID: ${id}` },
//             true
//         );

//         // ✅ Create a notification
//         await createNotification(
//             req,
//             "Class Schedule Updated",
//             `Class "${req.body.className}" was updated for ${req.body.day}, ${req.body.startTime} - ${req.body.endTime}.`,
//             "System"
//         );

//         // ✅ Final response
//         return res.status(200).json({
//             status: true,
//             message: "Class schedule updated successfully.",
//             data: result.data,
//         });
//     } catch (error) {
//         console.error("❌ Error updating class schedule:", error);

//         await logActivity(
//             req,
//             PANEL,
//             MODULE,
//             "update",
//             { oneLineMessage: error.message || "Unknown error" },
//             false
//         );

//         return res.status(500).json({
//             status: false,
//             message: "Server error: " + (error.message || "Something went wrong"),
//         });
//     }
// };

// exports.updateClassSchedule = async (req, res) => {
//   const { id } = req.params;
//   const adminId = req.admin?.id;

//   try {
//     // ✅ Validate venue
//     const venue = await Venue.findByPk(req.body.venueId);
//     if (!venue) {
//       return res.status(404).json({
//         status: false,
//         message: "Venue not found. Please select a valid venue.",
//       });
//     }

//     // ✅ Validate existing class
//     const existingClass = await ClassSchedule.findByPk(id);
//     if (!existingClass) {
//       return res.status(404).json({
//         status: false,
//         message: "Class schedule not found.",
//       });
//     }

//     // ✅ Capacity logic (Add-on behavior)
//     let updatedCapacity = existingClass.capacity;
//     let updatedTotalCapacity = existingClass.totalCapacity;

//     if (req.body.capacity !== undefined) {
//       const addCapacity = Number(req.body.capacity);

//       if (isNaN(addCapacity)) {
//         return res.status(400).json({
//           status: false,
//           message: "Capacity must be a valid number.",
//         });
//       }

//       if (addCapacity < 0) {
//         return res.status(400).json({
//           status: false,
//           message: "Capacity cannot be negative.",
//         });
//       }

//       // ✅ Add-on logic
//       updatedCapacity += addCapacity;
//       updatedTotalCapacity += addCapacity;
//     }

//     // ✅ Perform the main update using your service
//     const result = await ClassScheduleService.updateClass(id, {
//       ...req.body,
//       capacity: updatedCapacity,
//       totalCapacity: updatedTotalCapacity,
//       createdBy: adminId,
//     });

//     if (!result.status) {
//       return res
//         .status(400)
//         .json({ status: false, message: result.message || "Update failed." });
//     }

//     // ✅ Log the update activity
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: `Updated class schedule with ID: ${id}` },
//       true
//     );

//     // ✅ Create a notification
//     await createNotification(
//       req,
//       "Class Schedule Updated",
//       `Class "${req.body.className}" was updated for ${req.body.day}, ${req.body.startTime} - ${req.body.endTime}.`,
//       "System"
//     );

//     // ✅ Final response
//     return res.status(200).json({
//       status: true,
//       message: "Class schedule updated successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error updating class schedule:", error);

//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: error.message || "Unknown error" },
//       false
//     );

//     return res.status(500).json({
//       status: false,
//       message: "Server error: " + (error.message || "Something went wrong"),
//     });
//   }
// };

// exports.getClassScheduleDetails = async (req, res) => {
//   const { id } = req.params;
//   const adminId = req.admin?.id;
//   if (DEBUG) console.log(`🔍 Fetching class + venue for class ID: ${id}`);

//   try {
//     const result = await ClassScheduleService.getClassByIdWithFullDetails(
//       id,
//       adminId
//     );

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Not found:", result.message);
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log("✅ Data fetched:", result.data);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "getById",
//       { oneLineMessage: `Fetched class schedule with ID: ${id}` },
//       true
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Class and venue fetched successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching class schedule:", error);
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.updateClassSchedule = async (req, res) => {
//   const { id } = req.params;
//   const {
//     className,
//     capacity,
//     day,
//     startTime,
//     endTime,
//     allowFreeTrial,
//     facility,
//     venueId,
//   } = req.body;

//   const adminId = req.admin?.id;

//   if (DEBUG) console.log(`✏️ Updating class schedule ID: ${id}`, req.body);

//   const validation = validateFormData(req.body, {
//     requiredFields: ["className", "day", "startTime", "endTime", "venueId"],
//   });

//   if (!validation.isValid) {
//     if (DEBUG) console.log("❌ Validation failed:", validation.error);
//     await logActivity(req, PANEL, MODULE, "update", validation.error, false);
//     return res.status(400).json({ status: false, ...validation });
//   }

//   const venue = await Venue.findByPk(venueId);
//   if (!venue) {
//     if (DEBUG) console.log("❌ Invalid venue ID:", venueId);
//     return res.status(404).json({
//       status: false,
//       message: "Venue not found. Please select a valid venue.",
//     });
//   }

//   try {
//     const result = await ClassScheduleService.updateClass(id, {
//       className,
//       capacity,
//       day,
//       startTime,
//       endTime,
//       allowFreeTrial,
//       facility,
//       venueId,
//       createdBy: adminId, // ✅ FIXED HERE
//     });

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Update failed:", result.message);
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log("✅ Class schedule updated:", result.data);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: `Updated class schedule with ID: ${id}` },
//       true
//     );

//     await createNotification(
//       req,
//       "Class Schedule Updated",
//       `Class "${className}" was updated for ${day}, ${startTime} - ${endTime}.`,
//       "System"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Class schedule updated successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error updating class schedule:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.updateClassSchedule = async (req, res) => {
//   const { id } = req.params;
//   const {
//     className,
//     capacity,
//     day,
//     startTime,
//     endTime,
//     allowFreeTrial,
//     facility,
//     venueId,
//   } = req.body;

//   const adminId = req.admin?.id;

//   if (DEBUG) console.log(`✏️ Updating class schedule ID: ${id}`, req.body);

//   const validation = validateFormData(req.body, {
//     requiredFields: ["className", "day", "startTime", "endTime", "venueId"],
//   });

//   if (!validation.isValid) {
//     if (DEBUG) console.log("❌ Validation failed:", validation.error);
//     await logActivity(req, PANEL, MODULE, "update", validation.error, false);
//     return res.status(400).json({ status: false, ...validation });
//   }

//   const venue = await Venue.findByPk(venueId);
//   if (!venue) {
//     if (DEBUG) console.log("❌ Invalid venue ID:", venueId);
//     return res.status(404).json({
//       status: false,
//       message: "Venue not found. Please select a valid venue.",
//     });
//   }

//   try {
//     // ✅ Fetch existing record to apply capacity logic
//     const existingClass = await ClassSchedule.findByPk(id);
//     if (!existingClass) {
//       return res.status(404).json({
//         status: false,
//         message: "Class schedule not found.",
//       });
//     }

//     let updatedCapacity = existingClass.capacity;
//     let updatedTotalCapacity = existingClass.totalCapacity;

//     if (capacity !== undefined) {
//       if (capacity < existingClass.capacity) {
//         // 🔻 Decrease capacity → reduce only capacity
//         updatedCapacity = capacity;
//         updatedTotalCapacity = existingClass.totalCapacity;
//       } else if (capacity > existingClass.capacity) {
//         // 🔺 Increase capacity → increase totalCapacity, keep current capacity same
//         const diff = capacity - existingClass.capacity;
//         updatedTotalCapacity = existingClass.totalCapacity + diff;
//         updatedCapacity = existingClass.capacity;
//       }
//     }

//     // ✅ Now call your service
//     const result = await ClassScheduleService.updateClass(id, {
//       className,
//       capacity: updatedCapacity,
//       totalCapacity: updatedTotalCapacity,
//       day,
//       startTime,
//       endTime,
//       allowFreeTrial,
//       facility,
//       venueId,
//       createdBy: adminId, // ✅ keep same variable
//     });

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Update failed:", result.message);
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log("✅ Class schedule updated:", result.data);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: `Updated class schedule with ID: ${id}` },
//       true
//     );

//     await createNotification(
//       req,
//       "Class Schedule Updated",
//       `Class "${className}" was updated for ${day}, ${startTime} - ${endTime}.`,
//       "System"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Class schedule updated successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error updating class schedule:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// exports.updateClassSchedule = async (req, res) => {
//   const { id } = req.params;
//   const {
//     className,
//     capacity,
//     day,
//     startTime,
//     endTime,
//     allowFreeTrial,
//     facility,
//     venueId,
//   } = req.body;

//   const adminId = req.admin?.id; // ✅ Get logged-in admin ID

//   if (DEBUG) {
//     console.log(`✏️ Updating class schedule ID: ${id}`, req.body);
//   }

//   // ✅ Validate required fields
//   const validation = validateFormData(req.body, {
//     requiredFields: ["className", "day", "startTime", "endTime", "venueId"],
//   });

//   if (!validation.isValid) {
//     if (DEBUG) console.log("❌ Validation failed:", validation.error);
//     await logActivity(req, PANEL, MODULE, "update", validation.error, false);
//     return res.status(400).json({ status: false, ...validation });
//   }

//   // ✅ Validate venue
//   const venue = await Venue.findByPk(venueId);
//   if (!venue) {
//     if (DEBUG) console.log("❌ Invalid venue ID:", venueId);
//     return res.status(404).json({
//       status: false,
//       message: "Venue not found. Please select a valid venue.",
//     });
//   }

//   try {
//     // ✅ Get class schedule with createdBy
//     const classSchedule = await ClassScheduleService.findByPk(id);
//     if (!classSchedule) {
//       return res.status(404).json({
//         status: false,
//         message: "Class schedule not found.",
//       });
//     }

//     // ✅ Authorization check
//     if (classSchedule.createdBy !== adminId) {
//       if (DEBUG)
//         console.log("🚫 Unauthorized update attempt by admin:", adminId);
//       return res.status(403).json({
//         status: false,
//         message: "You are not authorized to update this class schedule.",
//       });
//     }

//     // ✅ Proceed with update
//     const result = await ClassScheduleService.updateClass(id, {
//       className,
//       capacity,
//       day,
//       startTime,
//       endTime,
//       allowFreeTrial,
//       facility,
//       venueId,
//     });

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Update failed:", result.message);
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log("✅ Class schedule updated:", result.data);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: `Updated class schedule with ID: ${id}` },
//       true
//     );

//     await createNotification(
//       req,
//       "Class Schedule Updated",
//       `Class "${className}" was updated for ${day}, ${startTime} - ${endTime}.`,
//       "Admins"
//     );

//     return res.status(200).json({
//       status: true,
//       message: "Class schedule updated successfully.",
//       data: result.data,
//     });
//   } catch (error) {
//     console.error("❌ Error updating class schedule:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "update",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// ✅ DELETE Class Schedule
// exports.deleteClassSchedule = async (req, res) => {
//   const { id } = req.params;
//   if (DEBUG) console.log(`🗑️ Deleting class schedule with ID: ${id}`);

//   try {
//     const result = await ClassScheduleService.deleteClass(id);

//     if (!result.status) {
//       if (DEBUG) console.log("⚠️ Delete failed:", result.message);
//       return res.status(404).json({ status: false, message: result.message });
//     }

//     if (DEBUG) console.log("✅ Class schedule deleted");
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "delete",
//       { oneLineMessage: `Deleted class schedule with ID: ${id}` },
//       true
//     );
//     // ✅ Create notification
//     await createNotification(
//       req,
//       "Class Schedule Deleted",
//       `Class schedule with ID ${id} has been deleted.`,
//       "Admins"
//     );
//     return res.status(200).json({
//       status: true,
//       message: "Class schedule deleted successfully.",
//     });
//   } catch (error) {
//     console.error("❌ Error deleting class schedule:", error);
//     await logActivity(
//       req,
//       PANEL,
//       MODULE,
//       "delete",
//       { oneLineMessage: error.message },
//       false
//     );
//     return res.status(500).json({ status: false, message: "Server error." });
//   }
// };

// 🔹 DELETE Class Schedule

exports.updateHolidayClassSchedule = async (req, res) => {
    const { id } = req.params;
    const adminId = req.admin?.id;

    try {
        // ✅ Validate venue
        const venue = await HolidayVenue.findByPk(req.body.venueId);
        if (!venue) {
            return res.status(404).json({
                status: false,
                message: "Venue not found. Please select a valid venue.",
            });
        }

        // ✅ Validate existing class
        const existingClass = await HolidayClassSchedule.findByPk(id);
        if (!existingClass) {
            return res.status(404).json({
                status: false,
                message: "Class schedule not found.",
            });
        }

        // ✅ Temporarily update capacity
        let updatedCapacity = existingClass.capacity;
        let updatedTotalCapacity = existingClass.totalCapacity;

        if (req.body.capacity !== undefined) {
            const requestedCapacity = Number(req.body.capacity);

            if (isNaN(requestedCapacity) || requestedCapacity < 0) {
                return res.status(400).json({
                    status: false,
                    message: "Capacity must be a valid non-negative number.",
                });
            }

            updatedCapacity = requestedCapacity;
            updatedTotalCapacity = requestedCapacity; // temporary logic: totalCapacity = capacity
        }

        // ✅ Perform the update
        const result = await ClassScheduleService.updateHolidayClass(id, {
            ...req.body,
            capacity: updatedCapacity,
            totalCapacity: updatedTotalCapacity,
            createdBy: adminId, // optionally you can skip updating createdBy here
        });

        if (!result.status) {
            return res.status(400).json({
                status: false,
                message: result.message || "Update failed.",
            });
        }

        // ✅ Log the update activity
        await logActivity(
            req,
            PANEL,
            MODULE,
            "update",
            { oneLineMessage: `Updated class schedule with ID: ${id}` },
            true
        );

        // ✅ Create a notification
        await createNotification(
            req,
            "Class Schedule Updated",
            `Class "${req.body.className}" was updated for ${req.body.day}, ${req.body.startTime} - ${req.body.endTime}.`,
            "System"
        );

        return res.status(200).json({
            status: true,
            message: "Class schedule updated successfully.",
            data: result.data,
        });
    } catch (error) {
        console.error("❌ Error updating class schedule:", error);

        await logActivity(
            req,
            PANEL,
            MODULE,
            "update",
            { oneLineMessage: error.message || "Unknown error" },
            false
        );

        return res.status(500).json({
            status: false,
            message: "Server error: " + (error.message || "Something went wrong"),
        });
    }
};

exports.deleteHolidayClassSchedule = async (req, res) => {
    const { id } = req.params;
    const adminId = req.admin?.id;

    if (DEBUG) console.log(`🗑️ deleting class schedule with ID: ${id}`);

    try {
        const result = await ClassScheduleService.deleteHolidayClass(id, adminId);

        if (!result.status) {
            if (DEBUG) console.log("⚠️ Delete failed:", result.message);
            await logActivity(req, PANEL, MODULE, "delete", result, false);
            return res.status(404).json({ status: false, message: result.message });
        }

        if (DEBUG) console.log("✅ Class schedule deleted");

        // Log activity
        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            { oneLineMessage: `Deleted class schedule with ID: ${id}` },
            true
        );

        // Create notification
        await createNotification(
            req,
            "Class Schedule Deleted",
            `Class schedule with ID ${id} has been deleted by ${req.admin?.firstName || "Admin"
            }.`,
            "Admins"
        );

        return res.status(200).json({
            status: true,
            message: "Class schedule deleted successfully.",
        });
    } catch (error) {
        console.error("❌ deleteHolidayClassSchedule Controller Error:", error);
        await logActivity(
            req,
            PANEL,
            MODULE,
            "delete",
            { oneLineMessage: error.message },
            false
        );
        return res.status(500).json({ status: false, message: "Server error." });
    }
};
