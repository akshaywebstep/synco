const express = require("express");
const router = express.Router({ mergeParams: true });
const authMiddleware = require("../../../../../middleware/admin/authenticate");

const {
  createCustomer
} = require("../../../../../controllers/test/payment/pay360/customer");

router.post("/", authMiddleware, createCustomer);

module.exports = router;
