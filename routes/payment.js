const express = require("express");
const router = express.Router();
const {
  createStripePayment,
  createMpesaPayment,
  mpesaWebhook,
} = require("../controllers/payment");
const authenticate = require("../middleware/auth");

// Payment routes
router.post("/stripe", authenticate, createStripePayment);
router.post("/mpesa", authenticate, createMpesaPayment);
router.post("/mpesa/webhook", mpesaWebhook);

module.exports = router;
