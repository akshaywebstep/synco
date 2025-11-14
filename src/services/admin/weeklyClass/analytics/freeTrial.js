// services/admin/monthlyClass.js
const { Op } = require("sequelize");
const moment = require("moment");

const {
    Booking,
    BookingStudentMeta,
    BookingParentMeta,
    BookingEmergencyMeta,
    ClassSchedule,
    Venue,
    Lead,
    BookingPayment,
    PaymentPlan,
    Admin,
} = require("../../../../models");

// Helper functions
function countFreeTrials(bookings) {
    return bookings.reduce((sum, b) => {
        // Check if trialDate is not null and type is 'free'
        if (b.trialDate !== null || b.type === 'free') {
            return sum + 1; // or sum + b.amount if you want to sum a value
        }
        return sum;
    }, 0);
}

function countAttendedTrials(bookings) {
    return bookings.reduce((sum, b) => {
        if (b.students && Array.isArray(b.students)) {
            // Count students with attendance === 'attended'
            const attendedCount = b.students.filter(student => student.attendance === 'attended').length;
            return sum + attendedCount;
        }
        return sum;
    }, 0);
}

function countTrialToMember(bookings) {
    return bookings.reduce((sum, b) => {
        if (
            b.isConvertedToMembership === true ||
            b.isConvertedToMembership === 1 ||
            b.isConvertedToMembership === '1'
        ) {
            return sum + 1;
        }
        return sum;
    }, 0);
}

const countRebook = (bookings) =>
    bookings.reduce((sum, b) => sum + (b.status === 'rebooked' ? 1 : 0), 0);

function calcPercentageDiff(currentStats, lastStats, isYear = false) {
    const current = currentStats?.freeTrialsCount ?? 0;

    let last = 0;
    if (lastStats) {
        // Unwrap lastStats if it’s already a diff object
        last = lastStats.currentMonthStats?.freeTrialsCount ?? lastStats?.freeTrialsCount ?? 0;
    }

    if (last === 0 && current === 0) {
        return {
            percent: 0,
            color: "gray",
            message: "No change",
            ...(isYear ? { currentYearStats: currentStats, lastYearStats: lastStats } : { currentMonthStats: currentStats, lastMonthStats: lastStats })
        };
    }

    const diff = ((current - last) / last) * 100;
    return {
        percent: Math.abs(diff.toFixed(2)),
        color: diff >= 0 ? "green" : "red",
        message: diff >= 0 ? `Increased by ${Math.abs(diff.toFixed(2))}%` : `Decreased by ${Math.abs(diff.toFixed(2))}%`,
        ...(isYear ? { currentYearStats: currentStats, lastYearStats: lastStats } : { currentMonthStats: currentStats, lastMonthStats: lastStats })
    };
}

// Group bookings by Year → Month
function groupBookingsByYearMonth(bookings, filter) {
    if (!bookings || bookings.length === 0) return {};

    bookings.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const startDate = moment(bookings[0].createdAt).startOf("month");
    const endDate = moment(bookings[bookings.length - 1].createdAt).endOf("month");

    const grouped = {};
    let current = startDate.clone();

    while (current.isSameOrBefore(endDate, "month")) {
        const yearKey = current.format("YYYY");
        const monthKey = current.format("MM");

        const monthBookings = bookings.filter(b => moment(b.createdAt).isBetween(current.clone().startOf("month"), current.clone().endOf("month"), null, "[]"));

        const freeTrialsCount = countFreeTrials(monthBookings);
        const attendedCount = countAttendedTrials(monthBookings);

        const attendanceRate = freeTrialsCount > 0
            ? Number(((attendedCount / freeTrialsCount) * 100).toFixed(2))
            : 0;

        const trialToMemberCount = countTrialToMember(monthBookings);

        const conversionRate = freeTrialsCount > 0
            ? Number(((trialToMemberCount / freeTrialsCount) * 100).toFixed(2))
            : 0;

        const rebookCount = countRebook(monthBookings);

        const freeTrialTrend = { freeTrialsCount, attendedCount, attendanceRate, trialToMemberCount, conversionRate, rebookCount };

        const agents = [];
        const filteredBookings = [];
        const enrolledStudents = { byAge: {}, byGender: {}, byVenue: [] };
        const paymentPlansTrend = [];

        const marketingChannelPerformance = {};

        monthBookings.forEach(b => {
            if (b.venue) {
                const venueId = b.venue.id;

                // Check if this venue already exists in byVenue
                let venueEntry = enrolledStudents.byVenue.find(v => v.id === venueId);

                if (!venueEntry) {
                    // If not found, create a new entry
                    venueEntry = {
                        id: b.venue.id,
                        name: b.venue.name || null,
                        facility: b.venue.facility || null,
                        area: b.venue.area || null,
                        address: b.venue.address || null,
                        freeTrialsCount: 0,
                        studentsCount: 0,
                    };
                    enrolledStudents.byVenue.push(venueEntry);
                }

                // Increment counts for this venue
                venueEntry.freeTrialsCount += 1;
                venueEntry.studentsCount += (b.students ? b.students.length : 0);
            }

            if (b.lead && b.lead.status) {
                // If the lead status already exists, increment by 1
                if (marketingChannelPerformance[b.lead.status]) {
                    marketingChannelPerformance[b.lead.status] += 1;
                } else {
                    // Otherwise, initialize with 1
                    marketingChannelPerformance[b.lead.status] = 1;
                }
            }

            if (b.paymentPlan) {
                // Check if this paymentPlan.id already exists in paymentPlansTrend
                const existingPlan = paymentPlansTrend.find(p => p.id === b.paymentPlan.id);

                if (!existingPlan) {
                    // Push new plan
                    paymentPlansTrend.push({
                        id: b.paymentPlan.id,
                        title: b.paymentPlan.title,
                        price: b.paymentPlan.price,
                        priceLesson: b.paymentPlan.priceLesson,
                        interval: b.paymentPlan.interval,
                        duration: b.paymentPlan.duration,
                        joiningFee: b.paymentPlan.joiningFee,
                        students: b.students?.length || 0
                    });
                } else {
                    // Update existing plan's students count
                    existingPlan.students += b.students?.length || 0;
                }
            }

            let valid = true;
            // Student filter
            if (filter.student?.name?.trim()) {
                const search = filter.student.name.trim().toLowerCase();
                valid = b.students?.some(s => ((s.studentFirstName || "").toLowerCase().includes(search)) || ((s.studentLastName || "").toLowerCase().includes(search))) || false;
            }

            // Venue filter
            if (valid && filter.venue?.name?.trim()) {
                const search = filter.venue.name.trim().toLowerCase();
                valid = ((b.classSchedule?.venue?.name || "").toLowerCase() === search);
            }

            // PaymentPlan filter
            if (valid && filter.paymentPlan?.interval?.trim() && filter.paymentPlan.duration > 0) {
                const searchInterval = filter.paymentPlan.interval.trim().toLowerCase();
                const searchDuration = Number(filter.paymentPlan.duration);
                const interval = (b.paymentPlan?.interval || "").toLowerCase();
                const duration = Number(b.paymentPlan?.duration || 0);
                valid = interval === searchInterval && duration === searchDuration;
            }

            // Admin filter
            if (valid && filter.admin?.name?.trim()) {
                const search = filter.admin.name.trim().toLowerCase();
                const firstName = (b.bookedByAdmin?.firstName || "").toLowerCase();
                const lastName = (b.bookedByAdmin?.lastName || "").toLowerCase();
                valid = firstName.includes(search) || lastName.includes(search);
            }

            if (valid) filteredBookings.push(b);

            // Students
            b.students.forEach(s => {
                if (s.dateOfBirth) {
                    const age = moment().diff(moment(s.dateOfBirth), 'years');
                    enrolledStudents.byAge[age] = (enrolledStudents.byAge[age] || 0) + 1;
                }

                const gender = (s.gender || "other").toLowerCase();
                enrolledStudents.byGender[gender] = (enrolledStudents.byGender[gender] || 0) + 1;
            });

            // Agents
            const admin = b.bookedByAdmin;
            if (!admin) return;

            if (!agents[admin.id]) agents[admin.id] = { id: admin.id, name: `${admin.firstName} ${admin.lastName}`, freeTrialTrend: { freeTrialsCount: 0, attendedCount: 0, attendanceRate: 0, trialToMemberCount: 0, conversionRate: 0, rebookCount: 0 } };

            if (b.trialDate !== null || b.type === 'free') {
                agents[admin.id].freeTrialTrend.freeTrialsCount += 1;
            }

            if (b.students && Array.isArray(b.students)) {
                // Count students with attendance === 'attended'
                agents[admin.id].freeTrialTrend.attendedCount += b.students.filter(student => student.attendance === 'attended').length;
            }

            agents[admin.id].freeTrialTrend.attendanceRate = agents[admin.id].freeTrialTrend.freeTrialsCount > 0
                ? (agents[admin.id].freeTrialTrend.attendedCount / agents[admin.id].freeTrialTrend.freeTrialsCount) * 100
                : 0;

            if (
                ((b.type === 'free' || b.trialDate !== null) && (b.paymentPlanId !== null || b.startDate !== null)) ||
                (b.trialDate !== null && b.startDate !== null)
            ) {
                agents[admin.id].freeTrialTrend.trialToMemberCount += 1; // count this booking
            }

            agents[admin.id].freeTrialTrend.conversionRate = agents[admin.id].freeTrialTrend.freeTrialsCount > 0
                ? (agents[admin.id].freeTrialTrend.trialToMemberCount / agents[admin.id].freeTrialTrend.freeTrialsCount) * 100
                : 0;

            if (b.status === 'rebooked') {
                agents[admin.id].freeTrialTrend.rebookCount += 1;
            }
        });

        const agentSummary = Object.values(agents).sort((a, b) => b.freeTrialTrend.freeTrialsCount - a.freeTrialTrend.freeTrialsCount);

        if (!grouped[yearKey]) grouped[yearKey] = { monthlyGrouped: {} };

        grouped[yearKey].monthlyGrouped[monthKey] = { bookings: filteredBookings, freeTrialTrend, agentSummary, enrolledStudents, paymentPlansTrend, marketingChannelPerformance };

        current.add(1, "month");
    }

    // Month-over-month trends
    Object.keys(grouped).forEach(yearKey => {
        const months = Object.keys(grouped[yearKey].monthlyGrouped).sort();
        months.forEach((monthKey, i) => {
            const monthData = grouped[yearKey].monthlyGrouped[monthKey];
            if (i === 0) {
                monthData.freeTrialTrend = calcPercentageDiff(monthData.freeTrialTrend, null);
                monthData.agentSummary = monthData.agentSummary.map(agent => {
                    const { freeTrialTrend, ...rest } = agent;
                    return { ...rest, freeTrialTrend: calcPercentageDiff(freeTrialTrend, null) };
                });
            } else {
                const lastMonthKey = months[i - 1];
                const lastMonthData = grouped[yearKey].monthlyGrouped[lastMonthKey];

                monthData.freeTrialTrend = calcPercentageDiff(monthData.freeTrialTrend, lastMonthData.freeTrialTrend);
                monthData.agentSummary = monthData.agentSummary.map(agent => {
                    const prev = lastMonthData.agentSummary.find(a => a.id === agent.id);
                    const { freeTrialTrend, ...rest } = agent;
                    return { ...rest, freeTrialTrend: calcPercentageDiff(agent.freeTrialTrend, prev ? prev.freeTrialTrend : null) };
                });
            }
        });

        // Yearly freeTrialTrend
        const yearTotal = { freeTrialsCount: 0, attendedCount: 0, attendanceRate: 0, trialToMemberCount: 0, conversionRate: 0, rebookCount: 0 };
        const lastYearTotal = grouped[String(Number(yearKey) - 1)]?.yearlyTotal || null;
        const yearlyMarketingPerformance = {};

        Object.values(grouped[yearKey].monthlyGrouped).forEach(m => {
            const monthStats = m.freeTrialTrend.currentMonthStats;

            // ✅ Aggregate numeric stats
            yearTotal.freeTrialsCount += monthStats.freeTrialsCount;
            yearTotal.attendedCount += monthStats.attendedCount;
            yearTotal.attendanceRate += monthStats.attendanceRate;
            yearTotal.trialToMemberCount += monthStats.trialToMemberCount;
            yearTotal.conversionRate += monthStats.conversionRate;
            yearTotal.rebookCount += monthStats.rebookCount;

            // ✅ Combine marketing channel performance across months
            const monthlyMarketing = m.marketingChannelPerformance || {};
            Object.entries(monthlyMarketing).forEach(([channel, count]) => {
                yearlyMarketingPerformance[channel] =
                    (yearlyMarketingPerformance[channel] || 0) + count;
            });
        });

        // ✅ Store yearly marketing performance directly under the year group
        grouped[yearKey].marketingChannelPerformance = yearlyMarketingPerformance;

        // ✅ Compute percentage difference
        grouped[yearKey].freeTrialTrend = calcPercentageDiff(yearTotal, lastYearTotal, true);
    });

    return grouped;
}

// Main Report
const getMonthlyReport = async (filters) => {
    try {
        const bookings = await Booking.findAll({
            order: [["id", "DESC"]],
            where: {
                [Op.or]: [
                    { bookingType: 'free' },
                    { bookingType: 'paid' },
                    { trialDate: { [Op.not]: null } }
                ]
            },
            include: [
                { model: Venue, as: "venue", required: false },
                { model: Lead, as: "lead", required: false },
                { model: BookingStudentMeta, as: "students", include: [{ model: BookingParentMeta, as: "parents", required: false }, { model: BookingEmergencyMeta, as: "emergencyContacts", required: false }], required: false },
                { model: ClassSchedule, as: "classSchedule", required: false, include: [{ model: Venue, as: "venue", required: false }] },
                { model: BookingPayment, as: "payments", required: false },
                { model: PaymentPlan, as: "paymentPlan", required: false },
                { model: Admin, as: "bookedByAdmin", attributes: ["id", "firstName", "lastName", "email", "roleId", "status", "profile"], required: false },
            ],
        });

        const yealyGrouped = groupBookingsByYearMonth(bookings, filters);

        // Overall Sales
        const overallTrends = { freeTrialsCount: 0, attendedCount: 0, attendanceRate: 0, trialToMemberCount: 0, conversionRate: 0, rebookCount: 0 };
        const overallMarketingPerformance = {};

        Object.values(yealyGrouped).forEach(year => {
            Object.values(year.monthlyGrouped).forEach(month => {
                const s = month.freeTrialTrend.currentMonthStats;
                overallTrends.freeTrialsCount += s.freeTrialsCount;
                overallTrends.attendedCount += s.attendedCount;
                overallTrends.attendanceRate += s.attendanceRate;
                overallTrends.trialToMemberCount += s.trialToMemberCount;
                overallTrends.conversionRate += s.conversionRate;
                overallTrends.rebookCount += s.rebookCount;

                const monthlyMarketing = month.marketingChannelPerformance || {};
                Object.entries(monthlyMarketing).forEach(([channel, count]) => {
                    overallMarketingPerformance[channel] =
                        (overallMarketingPerformance[channel] || 0) + count;
                });
            });
        });

        return { status: true, message: "Monthly class report generated successfully.", data: { yealyGrouped, overallTrends, overallMarketingPerformance } };
    } catch (error) {
        console.error("❌ Sequelize Error:", error);
        return { status: false, message: error?.parent?.sqlMessage || error?.message || "Error occurred while generating monthly class report." };
    }
};

module.exports = { getMonthlyReport };
