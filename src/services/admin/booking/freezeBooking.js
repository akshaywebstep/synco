const {
  sequelize,
  FreezeBooking,
  Booking,
  BookingStudentMeta,
  BookingParentMeta,
  BookingEmergencyMeta,
  BookingPayment,
  Venue,
  ClassSchedule,
  PaymentPlan,
  WaitingList,
  CancelBooking,
} = require("../../../models");
const { Op } = require("sequelize");

const { freezeContract, reactivateContract } = require("../../../utils/payment/accessPaySuit/accesPaySuit");
const DEBUG = process.env.DEBUG === "true";

exports.createFreezeBooking = async ({
  bookingId,
  freezeStartDate,
  freezeDurationMonths,
  reasonForFreezing,
}) => {
  const t = await sequelize.transaction();

  try {
    // 🔹 1. Validate booking
    const booking = await Booking.findByPk(bookingId, { transaction: t });
    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    // 🔹 2. Fetch payment info
    const bookingPayment = await BookingPayment.findOne({
      where: { bookingId },
      transaction: t,
    });

    if (!bookingPayment) {
      await t.rollback();
      return { status: false, message: "Booking payment not found." };
    }

    if (DEBUG) {
      console.log("📌 Booking payment type:", bookingPayment.paymentType);
    }

    // 🔹 3. Calculate reactivation date
    const reactivateOn = new Date(freezeStartDate);
    reactivateOn.setMonth(
      reactivateOn.getMonth() + Number(freezeDurationMonths)
    );

    // 🔹 4. Prevent duplicate active freeze
    const existingFreeze = await FreezeBooking.findOne({
      where: {
        bookingId,
        reactivateOn: { [Op.gte]: new Date() },
      },
      transaction: t,
    });

    if (existingFreeze) {
      await t.rollback();
      return {
        status: false,
        message: "Booking is already under a freeze period.",
      };
    }

    // 🔹 5. Freeze in Access PaySuite (ONLY if APS)
    if (bookingPayment.paymentType === "accesspaysuite") {
      let gatewayResponse = bookingPayment.gatewayResponse;

      // ✅ Handle both normal JSON object and escaped JSON string
      try {
        if (typeof gatewayResponse === "string") {
          gatewayResponse = JSON.parse(gatewayResponse);

          // If it was double-escaped (like your example), parse again
          if (typeof gatewayResponse === "string" && gatewayResponse.startsWith("{")) {
            gatewayResponse = JSON.parse(gatewayResponse);
          }
        }
      } catch (err) {
        console.warn("⚠️ Failed to parse gatewayResponse, using as-is:", err);
      }

      // ✅ Resolve contractId correctly
      const contractId =
        bookingPayment.contractId || // direct column
        gatewayResponse?.contract?.Id || // APS v1 style
        gatewayResponse?.contract?.id; // APS v2 style

      if (!contractId) {
        await t.rollback();
        return {
          status: false,
          message: "APS contract ID missing for this booking.",
        };
      }

      if (DEBUG) {
        console.log("🔒 Freezing APS contract:", contractId);
      }

      const apsFreezeResponse = await freezeContract(contractId, {
        from: freezeStartDate,
        to: reactivateOn,
        comment: reasonForFreezing || "Membership freeze",
      });

      if (!apsFreezeResponse?.status) {
        await t.rollback();
        return {
          status: false,
          message:
            apsFreezeResponse?.message ||
            "Failed to freeze membership in Access PaySuite.",
        };
      }

      if (DEBUG) {
        console.log("✅ APS freeze successful for contract:", contractId);
      }
    }

    // 🔹 6. Create FreezeBooking record
    const freezeRecord = await FreezeBooking.create(
      {
        bookingId,
        freezeStartDate,
        freezeDurationMonths,
        reactivateOn,
        reasonForFreezing: reasonForFreezing || null,
      },
      { transaction: t }
    );

    // 🔹 7. (Optional) Update booking status
    // await booking.update({ status: "frozen" }, { transaction: t });

    await t.commit();

    return {
      status: true,
      message: "Booking frozen successfully.",
      data: {
        freezeRecord,
        bookingDetails: booking,
      },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ createFreezeBooking Error:", error);
    return { status: false, message: error.message };
  }
};
/*
exports.reactivateBooking = async (
  bookingId,
  payload,
  reactivateOn = null,
  additionalNote = null
) => {
  const t = await sequelize.transaction();

  try {
    // --------------------------------------------------
    // 1. Fetch booking
    // --------------------------------------------------
    const booking = await Booking.findByPk(bookingId, {
      transaction: t,
      include: [{ model: BookingPayment, as: "payments" }],
    });

    if (!booking) {
      throw new Error("Booking not found");
    }

    const wasCancelled = booking.status === "cancelled";
    const wasFrozen = booking.status === "frozen";

    // --------------------------------------------------
    // 2. Capacity check (ONLY if cancelled)
    // --------------------------------------------------
    if (wasCancelled) {
      const studentCount = await BookingStudentMeta.count({
        where: { bookingTrialId: bookingId },
        transaction: t,
      });

      const classSchedule = await ClassSchedule.findByPk(
        booking.classScheduleId,
        { transaction: t, lock: t.LOCK.UPDATE }
      );

      if (!classSchedule || classSchedule.capacity < studentCount) {
        throw new Error("Insufficient capacity to reactivate booking");
      }

      await classSchedule.decrement("capacity", {
        by: studentCount,
        transaction: t,
      });
    }

    // --------------------------------------------------
    // 3. IF CANCELLED → CREATE NEW PAYMENT
    // --------------------------------------------------
    if (wasCancelled) {
      if (!payload?.payment?.paymentType) {
        throw new Error("Payment details required for cancelled booking");
      }

      const data = payload; // keep naming consistent with your original logic
      const paymentType = data.payment.paymentType;
      let paymentStatusFromGateway = "pending";

      const studentRecords = await BookingStudentMeta.findAll({
        where: { bookingTrialId: bookingId },
        transaction: t,
      });

      const firstStudentId = studentRecords[0]?.id;

      const paymentPlan = booking.paymentPlanId
        ? await PaymentPlan.findByPk(booking.paymentPlanId, { transaction: t })
        : null;

      const payloadPrice = Number(data.payment?.price);
      if (isNaN(payloadPrice) || payloadPrice <= 0) {
        throw new Error("Invalid payment price from payload");
      }

      const venue = await Venue.findByPk(data.venueId, { transaction: t });
      const classSchedule = await ClassSchedule.findByPk(
        data.classScheduleId,
        { transaction: t }
      );

      const merchantRef = `TRX-${Date.now()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

      let gatewayResponse = null;
      let goCardlessCustomer = null;
      let goCardlessBankAccount = null;
      let goCardlessBillingRequest = null;

      // ==================================================
      // BANK (GoCardless)
      // ==================================================
      if (paymentType === "bank") {
        const customerPayload = {
          email: data.payment.email || "",
          given_name: data.payment.firstName || "",
          family_name: data.payment.lastName || "",
          address_line1: data.payment.addressLine1 || "",
          city: data.payment.city || "",
          postal_code: data.payment.postalCode || "",
          country_code: data.payment.countryCode || "GB",
          currency: "GBP",
          account_holder_name: data.payment.account_holder_name || "",
          account_number: data.payment.account_number || "",
          branch_code: data.payment.branch_code || "",
        };

        const createCustomerRes = await createCustomer(customerPayload);
        if (!createCustomerRes.status)
          throw new Error("Failed to create GoCardless customer");

        const billingRequestPayload = {
          customerId: createCustomerRes.customer.id,
          description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"}`,
          amount: payloadPrice, // ✅ FROM PAYLOAD
          scheme: "faster_payments",
          currency: "GBP",
          reference: merchantRef,
          mandateReference: `MD-${Date.now()}-${Math.floor(
            1000 + Math.random() * 9000
          )}`,
          fallbackEnabled: true,
        };

        const billingRes = await createBillingRequest(billingRequestPayload);
        if (!billingRes.status) {
          await removeCustomer(createCustomerRes.customer.id);
          throw new Error("Failed to create billing request");
        }

        goCardlessCustomer = createCustomerRes.customer;
        goCardlessBankAccount = createCustomerRes.bankAccount;
        goCardlessBillingRequest = {
          ...billingRes.billingRequest,
          price: payloadPrice,
        };

        gatewayResponse = {
          gateway: "gocardless",
          goCardlessCustomer,
          goCardlessBankAccount,
          goCardlessBillingRequest,
        };

        paymentStatusFromGateway = "pending";
      }

      // ==================================================
      // ACCESS PAYSUITE
      // ==================================================
      if (paymentType === "accesspaysuite") {
        const schedulesRes = await getSchedules();
        if (!schedulesRes.status) {
          throw new Error("Access PaySuite: Failed to fetch schedules");
        }

        const services = schedulesRes.data?.Services || [];
        const schedules = services.flatMap(s => s.Schedules || []);

        const matchedSchedule = findMatchingSchedule(schedules, paymentPlan);
        if (!matchedSchedule) {
          throw new Error("Access PaySuite: Matching schedule not found");
        }

        const customerPayload = {
          email: data.payment.email,
          title: "Mr",
          customerRef: `BOOK-${booking.id}-${Date.now()}`,
          firstName: data.payment.firstName,
          surname: data.payment.lastName || "Unknown",
          line1: data.payment.addressLine1 || "N/A",
          postCode: data.payment.postalCode || "N/A",
          accountNumber: data.payment.account_number,
          bankSortCode: data.payment.branch_code,
          accountHolderName: data.payment.account_holder_name,
        };

        const customerRes = await createAccessPaySuiteCustomer(customerPayload);
        if (!customerRes.status)
          throw new Error("Access PaySuite: Customer creation failed");

        const customerId =
          customerRes.data?.CustomerId ||
          customerRes.data?.Id ||
          customerRes.data?.id;

        if (!customerId) {
          throw new Error("Access PaySuite: Customer ID missing");
        }

        const contractPayload = {
          scheduleName: matchedSchedule.Name,
          start: calculateContractStartDate(18),
          terminationType: paymentPlan?.duration ? "Fixed term" : "Until further notice",
          atTheEnd: "Switch to further notice",
        };

        if (paymentPlan?.duration) {
          const start = new Date(contractPayload.start);
          const end = new Date(start);
          end.setMonth(end.getMonth() + Number(paymentPlan.duration));
          contractPayload.TerminationDate = end.toISOString().split("T")[0];
        }

        const contractRes = await createContract(customerId, contractPayload);
        if (!contractRes.status)
          throw new Error("Access PaySuite: Contract creation failed");

        gatewayResponse = {
          gateway: "accesspaysuite",
          schedule: matchedSchedule,
          customer: customerRes.data,
          contract: contractRes.data,
        };

        paymentStatusFromGateway = "active";
      }

      // ==================================================
      // SAVE NEW BOOKING PAYMENT (SAME AS ORIGINAL)
      // ==================================================
      await BookingPayment.create(
        {
          bookingId: booking.id,
          paymentPlanId: booking.paymentPlanId,
          studentId: firstStudentId,

          paymentType,
          firstName: data.payment.firstName || "",
          lastName: data.payment.lastName || "",
          email: data.payment.email || "",

          amount: payloadPrice,
          price: payloadPrice,

          account_number: data.payment.account_number || "",
          branch_code: data.payment.branch_code || "",
          account_holder_name: data.payment.account_holder_name || "",

          paymentStatus: paymentStatusFromGateway,
          currency: "GBP",
          merchantRef,
          description: `${venue?.name || "Venue"} - ${classSchedule?.className || "Class"}`,
          commerceType: "ECOM",

          gatewayResponse,
          transactionMeta: { status: paymentStatusFromGateway },

          goCardlessCustomer,
          goCardlessBankAccount,
          goCardlessBillingRequest,
        },
        { transaction: t }
      );
    }

    // --------------------------------------------------
    // 4. IF FROZEN → REACTIVATE EXISTING PAYMENT
    // --------------------------------------------------
    if (wasFrozen) {
      const bookingPayment = booking.payments?.[0];
      if (!bookingPayment) throw new Error("Payment not found");

      if (bookingPayment.paymentType === "accesspaysuite") {
        let gatewayResponse = bookingPayment.gatewayResponse;
        if (typeof gatewayResponse === "string") {
          gatewayResponse = JSON.parse(gatewayResponse);
        }

        const contractId = gatewayResponse?.contract?.Id;
        if (!contractId) throw new Error("Contract ID missing");

        const apsRes = await reactivateContract(contractId, {
          reactivateOn,
          note: additionalNote || "",
        });

        if (!apsRes.status) throw new Error("APS reactivation failed");
      }

      await bookingPayment.update(
        { paymentStatus: "active" },
        { transaction: t }
      );
    }

    // --------------------------------------------------
    // 5. Update booking + cleanup
    // --------------------------------------------------
    await booking.update(
      {
        status: "active",
        additionalNote,
      },
      { transaction: t }
    );

    if (wasCancelled) {
      await CancelBooking.destroy({
        where: { bookingId, bookingType: "membership" },
        transaction: t,
      });
    }

    await t.commit();

    return {
      status: true,
      message: "Booking reactivated successfully",
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ reactivateBooking error:", error);
    return { status: false, message: error.message };
  }
};
*/

exports.reactivateBooking = async (bookingId, reactivateOn = null, additionalNote = null) => {
  const t = await sequelize.transaction();

  try {
    // --------------------------------------------------
    // 1. Fetch freeze record (if any)
    // --------------------------------------------------
    const freezeRecord = await FreezeBooking.findOne({
      where: {
        bookingId,
        reactivateOn: { [Op.gte]: new Date() },
      },
      transaction: t,
    });

    // --------------------------------------------------
    // 2. Fetch booking + payment
    // --------------------------------------------------
    const booking = await Booking.findByPk(bookingId, {
      transaction: t,
      include: [{ model: BookingPayment, as: "payments" }],
    });

    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    const bookingPayment = booking.payments?.[0];
    if (!bookingPayment) {
      await t.rollback();
      return { status: false, message: "Booking payment not found." };
    }

    // --------------------------------------------------
    // 3. Student count (capacity logic)
    // --------------------------------------------------
    const studentCount = await BookingStudentMeta.count({
      where: { bookingTrialId: bookingId },
      transaction: t,
    });

    if (studentCount === 0) {
      await t.rollback();
      return { status: false, message: "No students found for this booking." };
    }

    const wasCancelled = booking.status === "cancelled";
    const wasFrozen = booking.status === "frozen";
    const paymentType = bookingPayment.paymentType;

    // --------------------------------------------------
    // 4. Parse gateway response safely
    // --------------------------------------------------
    let gatewayResponse = bookingPayment.gatewayResponse;
    if (typeof gatewayResponse === "string") {
      try {
        gatewayResponse = JSON.parse(gatewayResponse);
      } catch {
        gatewayResponse = {};
      }
    }

    const contractId =
      bookingPayment.contractId ||
      gatewayResponse?.contract?.Id ||
      gatewayResponse?.contract?.id ||
      gatewayResponse?.contractId ||
      gatewayResponse?.contract_id ||
      null;

    // --------------------------------------------------
    // 5. Capacity check (ONLY for cancelled)
    // --------------------------------------------------
    if (wasCancelled) {
      const classSchedule = await ClassSchedule.findByPk(
        booking.classScheduleId,
        { transaction: t, lock: t.LOCK.UPDATE }
      );

      if (!classSchedule || classSchedule.capacity < studentCount) {
        await t.rollback();
        return {
          status: false,
          message: "Insufficient capacity to reactivate booking.",
        };
      }

      await classSchedule.decrement("capacity", {
        by: studentCount,
        transaction: t,
      });
    }

    // ==================================================
    // 6. ACCESSPAYSUITE REACTIVATION
    // ==================================================
    if (paymentType === "accesspaysuite") {
      if (!contractId) {
        await t.rollback();
        return { status: false, message: "Contract ID not found." };
      }

      const apsResult = await reactivateContract(contractId, {
        reactivateOn,
        note: additionalNote || "",
      });

      if (!apsResult.status) {
        await t.rollback();
        return { status: false, message: apsResult.message };
      }

      await bookingPayment.update(
        {
          paymentStatus: "active",
          gatewayResponse: JSON.stringify({
            ...(typeof gatewayResponse === "object" ? gatewayResponse : {}),
            apsReactivatedAt: new Date().toISOString(),
            apsResponse: apsResult.data || null,
          }),
        },
        { transaction: t }
      );
    }

    // ==================================================
    // 7. BANK / MANUAL REACTIVATION
    // ==================================================
    else {
      let transactionMeta = bookingPayment.transactionMeta;
      if (typeof transactionMeta === "string") {
        try {
          transactionMeta = JSON.parse(transactionMeta);
        } catch {
          transactionMeta = {};
        }
      }

      await bookingPayment.update(
        {
          paymentStatus: "active",
          transactionMeta: JSON.stringify({
            ...(typeof transactionMeta === "object" ? transactionMeta : {}),
            reactivatedAt: new Date().toISOString(),
            reactivatedBy: "admin",
          }),
        },
        { transaction: t }
      );
    }

    // --------------------------------------------------
    // 8. Update booking
    // --------------------------------------------------
    await booking.update(
      {
        status: "active",
        additionalNote: additionalNote || null,
      },
      { transaction: t }
    );

    // --------------------------------------------------
    // 9. Cleanup auxiliary tables
    // --------------------------------------------------
    if (wasCancelled) {
      await CancelBooking.destroy({
        where: { bookingId, bookingType: "membership" },
        transaction: t,
      });
    }

    if (wasFrozen && freezeRecord) {
      await freezeRecord.destroy({ transaction: t });
    }

    // --------------------------------------------------
    // 10. Commit
    // --------------------------------------------------
    await t.commit();

    // --------------------------------------------------
    // 11. Return updated booking
    // --------------------------------------------------
    const updatedBooking = await Booking.findByPk(bookingId, {
      include: [
        {
          model: ClassSchedule,
          as: "classSchedule",
          include: [{ model: Venue, as: "venue" }],
        },
        {
          model: BookingStudentMeta,
          as: "students",
          include: [
            { model: BookingParentMeta, as: "parents" },
            { model: BookingEmergencyMeta, as: "emergencyContacts" },
          ],
        },
      ],
    });

    return {
      status: true,
      message: "Booking reactivated successfully.",
      data: updatedBooking,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ reactivateBooking Error:", error);
    return { status: false, message: error.message };
  }
};

exports.listFreezeBookings = async (whereVenue = {}) => {
  const t = await sequelize.transaction();
  try {
    const freezeBookings = await FreezeBooking.findAll({
      include: [
        {
          model: Booking,
          as: "booking",
          include: [
            // ✅ ClassSchedule with Venue inside
            {
              model: ClassSchedule,
              as: "classSchedule",
              required: true,
              include: [
                {
                  model: Venue,
                  as: "venue",
                  where: whereVenue,
                  required: true,
                },
              ],
            },
            // ✅ Students with parents and emergency contacts
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
      order: [["freezeStartDate", "DESC"]],
      transaction: t,
    });

    await t.commit();
    return {
      status: true,
      message: "Freeze bookings fetched successfully.",
      data: freezeBookings,
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ listFreezeBookings Error:", error);
    return { status: false, message: error.message };
  }
};

exports.cancelWaitingListSpot = async ({
  bookingId,
  reasonForCancelling = null,
  additionalNote = null,
}) => {
  const t = await sequelize.transaction();
  try {
    // 🔹 1. Find booking
    const booking = await Booking.findByPk(bookingId, { transaction: t });

    if (!booking) {
      await t.rollback();
      return { status: false, message: "Booking not found." };
    }

    // 🔹 2. Update booking status to "cancelled"
    await booking.update({ status: "cancelled" }, { transaction: t });

    // 🔹 3. Update or Insert into CancelBooking table
    const existingCancel = await CancelBooking.findOne({
      where: { bookingId },
      transaction: t,
    });

    if (existingCancel) {
      await existingCancel.update(
        {
          reasonForCancelling,
          additionalNote,
          bookingType: "membership", // static value
        },
        { transaction: t }
      );
    } else {
      await CancelBooking.create(
        {
          bookingId,
          reasonForCancelling,
          additionalNote,
          bookingType: "membership", // static value
        },
        { transaction: t }
      );
    }

    await t.commit();
    return {
      status: true,
      message: "Booking marked as cancelled.",
      data: { bookingId, status: "cancelled" },
    };
  } catch (error) {
    await t.rollback();
    console.error("❌ cancelWaitingListSpot Error:", error);
    return { status: false, message: error.message };
  }
};
