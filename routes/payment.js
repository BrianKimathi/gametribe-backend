const express = require("express");
const router = express.Router();
const {
  createStripePayment,
  createMpesaPayment,
  mpesaWebhook,
  stripeWebhook,
  convertWalletToPoints,
} = require("../controllers/payment");
const authenticate = require("../middleware/auth");

// Payment routes
router.post("/stripe", authenticate, createStripePayment);
router.post("/mpesa", authenticate, createMpesaPayment);
router.post("/mpesa/webhook", mpesaWebhook);
router.post("/stripe/webhook", stripeWebhook);
router.post("/convert-wallet-to-points", authenticate, convertWalletToPoints);

module.exports = router;
