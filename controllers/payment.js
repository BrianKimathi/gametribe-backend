const { database } = require("../config/firebase");
const {
  ref,
  get,
  update,
  query,
  orderByChild,
  equalTo,
} = require("firebase/database");
const { v4: uuidv4 } = require("uuid");
const Stripe = require("stripe");
const axios = require("axios");
require("dotenv").config();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// M-Pesa credentials
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE;
const MPESA_PASSKEY = process.env.MPESA_PASSKEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Sanitize input
const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  return input.replace(/[<>]/g, "");
};

// Generate M-Pesa OAuth token
const getMpesaToken = async () => {
  try {
    const auth = Buffer.from(
      `${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`
    ).toString("base64");
    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      { headers: { Authorization: `Basic ${auth}` } }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("Error generating M-Pesa token:", {
      message: error.message,
      stack: error.stack,
    });
    throw new Error("Failed to generate M-Pesa token");
  }
};

// Create Stripe payment intent
const createStripePayment = async (req, res) => {
  try {
    const { amount, userId } = req.body;
    if (!amount || amount < 100 || amount > 10000) {
      return res
        .status(400)
        .json({ error: "Amount must be between KSH 100 and KSH 10,000" });
    }
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const userRef = ref(database, `users/${userId}`);
    const paymentUserSnapshot = await get(userRef);
    if (!paymentUserSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const transactionId = uuidv4();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: "kes",
      payment_method_types: ["card"],
      metadata: { userId, transactionId },
    });

    await update(ref(database, `transactions/${transactionId}`), {
      id: transactionId,
      userId,
      type: "deposit",
      method: "stripe",
      amount,
      currency: "KES",
      status: "pending",
      paymentIntentId: paymentIntent.id,
      createdAt: new Date().toISOString(),
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      transactionId,
    });
  } catch (error) {
    console.error("Error creating Stripe payment:", {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to create Stripe payment" });
  }
};

// Create M-Pesa STK Push payment
const createMpesaPayment = async (req, res) => {
  try {
    const { amount, phoneNumber, userId } = req.body;
    if (!amount || amount < 1 || amount > 10000) {
      return res
        .status(400)
        .json({ error: "Amount must be between KSH 1 and KSH 10,000" });
    }
    if (!phoneNumber || !phoneNumber.match(/^\+254[0-9]{9}$/)) {
      return res.status(400).json({
        error: "Valid phone number is required (e.g., +254712345678)",
      });
    }
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const userRef = ref(database, `users/${userId}`);
    const mpesaUserSnapshot = await get(userRef);
    if (!mpesaUserSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = await getMpesaToken();
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    const password = Buffer.from(
      `${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`
    ).toString("base64");

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber.replace("+", ""),
        PartyB: MPESA_SHORTCODE,
        PhoneNumber: phoneNumber.replace("+", ""),
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: `GameTribe_${userId}`,
        TransactionDesc: "Deposit to GameTribe Wallet",
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const transactionId = uuidv4();
    await update(ref(database, `transactions/${transactionId}`), {
      id: transactionId,
      userId,
      type: "deposit",
      method: "mpesa",
      amount,
      currency: "KES",
      status: "pending",
      checkoutRequestId: response.data.CheckoutRequestID,
      createdAt: new Date().toISOString(),
    });

    console.log(
      `Created M-Pesa transaction: ID=${transactionId}, CheckoutRequestID=${response.data.CheckoutRequestID}`
    );

    return res.status(200).json({
      transactionId,
      checkoutRequestId: response.data.CheckoutRequestID,
    });
  } catch (error) {
    console.error("Error creating M-Pesa payment:", {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to create M-Pesa payment" });
  }
};

// Stripe webhook handler
const stripeWebhook = async (req, res) => {
  console.log("Received POST /api/payments/stripe/webhook");
  console.log("Stripe signature:", req.headers["stripe-signature"]);
  console.log("Webhook payload length:", req.body.length);

  const sig = req.headers["stripe-signature"];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log(`Processing Stripe webhook event: ${event.id} (${event.type})`);

    const eventRef = ref(database, `webhook_events/${event.id}`);
    const eventSnapshot = await get(eventRef);
    if (eventSnapshot.exists()) {
      console.log(`Event ${event.id} already processed`);
      return res.status(200).json({ received: true });
    }

    await update(eventRef, {
      processed: true,
      type: event.type,
      createdAt: new Date().toISOString(),
    });

    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        const { transactionId, userId } = paymentIntent.metadata;

        if (!transactionId || !userId) {
          console.warn(
            "Missing transactionId or userId in payment intent metadata"
          );
          return res.status(200).json({ received: true });
        }

        const transactionRef = ref(database, `transactions/${transactionId}`);
        const transactionSnapshot = await get(transactionRef);
        if (!transactionSnapshot.exists()) {
          console.warn(`Transaction ${transactionId} not found`);
          return res.status(404).json({ error: "Transaction not found" });
        }

        const transaction = transactionSnapshot.val();
        if (transaction.status === "completed") {
          console.log(`Transaction ${transactionId} already completed`);
          return res.status(200).json({ received: true });
        }

        await update(transactionRef, {
          status: "completed",
          updatedAt: new Date().toISOString(),
        });

        const paymentUserRef = ref(database, `users/${userId}`);
        const paymentUserSnapshot = await get(paymentUserRef);
        if (paymentUserSnapshot.exists()) {
          const currentBalance = paymentUserSnapshot.val().balance || 0;
          const newBalance = currentBalance + paymentIntent.amount / 100;
          await update(paymentUserRef, { balance: newBalance });
          console.log(`Updated balance for user ${userId}: KSH ${newBalance}`);
        }
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        const subscription = event.data.object;
        const subscriptionStatus = subscription.status;
        const subscriptionId = subscription.id;
        const customerId = subscription.customer;
        console.log(
          `Subscription ${subscriptionId} ${event.type} with status ${subscriptionStatus}`
        );

        const subscriptionUserQuery = ref(database, "users");
        const subscriptionUserSnapshot = await get(
          query(
            subscriptionUserQuery,
            orderByChild("stripeCustomerId"),
            equalTo(customerId)
          )
        );
        if (subscriptionUserSnapshot.exists()) {
          const subUserId = Object.keys(subscriptionUserSnapshot.val())[0];
          await update(ref(database, `users/${subUserId}`), {
            subscriptionId,
            subscriptionStatus,
            updatedAt: new Date().toISOString(),
          });
          console.log(`Updated subscription for user ${subUserId}`);
        }
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Error processing Stripe webhook:", {
      message: error.message,
      stack: error.stack,
    });
    return res.status(400).json({ error: "Webhook error" });
  }
};


// M-Pesa webhook handler
const mpesaWebhook = async (req, res) => {
  try {
    const { Body } = req.body;
    const { stkCallback } = Body;
    const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

    const transactionRef = database
      .ref("transactions")
      .orderByChild("checkoutRequestId")
      .equalTo(CheckoutRequestID);
    const transactionSnapshot = await transactionRef.once("value");
    const transactionData = transactionSnapshot.val();
    if (!transactionData) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const transactionId = Object.keys(transactionData)[0];
    const transaction = transactionData[transactionId];

    if (ResultCode === 0) {
      // Success
      await database.ref(`transactions/${transactionId}`).update({
        status: "completed",
        updatedAt: new Date().toISOString(),
      });

      const userRef = database.ref(`users/${transaction.userId}`);
      const userSnapshot = await userRef.once("value");
      if (userSnapshot.exists()) {
        const userData = userSnapshot.val();
        const newBalance = (userData.balance || 0) + transaction.amount;
        await userRef.update({ balance: newBalance });
      }
    } else {
      // Failed
      await database.ref(`transactions/${transactionId}`).update({
        status: "failed",
        error: ResultDesc,
        updatedAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(
      "Error processing M-Pesa webhook:",
      error.message,
      error.stack
    );
    return res.status(500).json({ error: "Webhook error" });
  }
};
module.exports = {
  createStripePayment,
  createMpesaPayment,
  stripeWebhook,
  mpesaWebhook,
};
