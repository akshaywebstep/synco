const express = require('express');
const router = express.Router();

const paymentController = require('../../../../controllers/test/payment/stripe/stripeController');

router.post('/create-customer', paymentController.createCustomer);
router.post('/add-card', paymentController.addNewCard);
router.post('/create-charges', paymentController.createCharges);

module.exports = router;
