const express = require("express");
const router = express.Router();
const {
  createStripePayment,
  createMpesaPayment,
  stripeWebhook,
  mpesaWebhook,
} = require("../controllers/payment");
const authenticate = require("../middleware/auth");
const bodyParser = require("body-parser");

router.post("/stripe", authenticate, createStripePayment);
router.post("/mpesa", authenticate, createMpesaPayment);
router.post(
  "/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhook
);
router.post("/mpesa/webhook", mpesaWebhook);

module.exports = router;
