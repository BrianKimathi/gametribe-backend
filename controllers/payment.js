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

// Retry mechanism for database updates
const updateWithRetry = async (ref, data, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await update(ref, data);
      return;
    } catch (error) {
      console.error(`Retry ${i + 1} failed for update:`, {
        message: error.message,
        stack: error.stack,
      });
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
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
    const { amount, userId, currency = "kes" } = req.body;
    if (
      !amount ||
      amount < 100 ||
      amount > 10000 ||
      !Number.isInteger(amount)
    ) {
      return res.status(400).json({
        error: "Amount must be an integer between 100 and 10,000",
      });
    }
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "Valid User ID is required" });
    }

    const userRef = ref(database, `users/${userId}`);
    const paymentUserSnapshot = await get(userRef);
    if (!paymentUserSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const transactionId = uuidv4();
    const pointsToAdd = parseInt(amount); // 1 unit = 1 point, regardless of currency
    const stripeAmount =
      currency.toLowerCase() === "kes" ? amount * 100 : amount * 100; // Adjust for Stripe (cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: stripeAmount,
      currency: currency.toLowerCase(),
      payment_method_types: ["card"],
      metadata: { userId, transactionId, pointsToAdd: pointsToAdd.toString() },
    });

    await updateWithRetry(ref(database, `transactions/${transactionId}`), {
      id: transactionId,
      userId,
      type: "deposit",
      method: "stripe",
      amount,
      currency: currency.toUpperCase(),
      status: "pending",
      paymentIntentId: paymentIntent.id,
      pointsToAdd,
      createdAt: new Date().toISOString(),
    });

    console.log(
      `Created Stripe transaction: ID=${transactionId}, UserID=${userId}, Currency=${currency}, Points=${pointsToAdd}`
    );

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      transactionId,
      pointsToAdd,
    });
  } catch (error) {
    console.error("Error creating Stripe payment:", {
      message: error.message,
      stack: error.stack,
    });
    await updateWithRetry(ref(database, `webhook_errors/stripe_${uuidv4()}`), {
      error: `Failed to create Stripe payment: ${error.message}`,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ error: "Failed to create Stripe payment" });
  }
};

// Create M-Pesa STK Push payment
const createMpesaPayment = async (req, res) => {
  try {
    const { amount, phoneNumber, userId, currency = "KES" } = req.body;
    if (!amount || amount < 1 || amount > 10000 || !Number.isInteger(amount)) {
      return res.status(400).json({
        error: "Amount must be an integer between 1 and 10,000",
      });
    }
    if (!phoneNumber || !phoneNumber.match(/^\+254[0-9]{9}$/)) {
      return res.status(400).json({
        error: "Valid phone number is required (e.g., +254712345678)",
      });
    }
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "Valid User ID is required" });
    }

    const userRef = ref(database, `users/${userId}`);
    const mpesaUserSnapshot = await get(userRef);
    if (!mpesaUserSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const pointsToAdd = parseInt(amount); // 1 unit = 1 point, regardless of currency
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
    await updateWithRetry(ref(database, `transactions/${transactionId}`), {
      id: transactionId,
      userId,
      type: "deposit",
      method: "mpesa",
      amount,
      currency: currency.toUpperCase(),
      status: "pending",
      checkoutRequestId: response.data.CheckoutRequestID,
      pointsToAdd,
      createdAt: new Date().toISOString(),
    });

    console.log(
      `Created M-Pesa transaction: ID=${transactionId}, UserID=${userId}, CheckoutRequestID=${response.data.CheckoutRequestID}, Currency=${currency}, Points=${pointsToAdd}`
    );

    return res.status(200).json({
      transactionId,
      checkoutRequestId: response.data.CheckoutRequestID,
      pointsToAdd,
    });
  } catch (error) {
    console.error("Error creating M-Pesa payment:", {
      message: error.message,
      stack: error.stack,
    });
    await updateWithRetry(ref(database, `webhook_errors/mpesa_${uuidv4()}`), {
      error: `Failed to create M-Pesa payment: ${error.message}`,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ error: "Failed to create M-Pesa payment" });
  }
};

// Stripe webhook handler
const stripeWebhook = async (req, res) => {
  console.log("Received POST /api/payments/stripe/webhook");
  console.log("Stripe signature:", req.headers["stripe-signature"]);
  console.log("Webhook payload length:", req.body.length);
  console.log("Webhook secret used:", webhookSecret ? "Set" : "Undefined");

  if (!webhookSecret) {
    console.error("Stripe webhook secret is not defined");
    await updateWithRetry(ref(database, `webhook_errors/stripe_${uuidv4()}`), {
      error: "Webhook secret not defined",
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ error: "Webhook configuration error" });
  }

  const sig = req.headers["stripe-signature"];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log(`Processing Stripe webhook event: ${event.id} (${event.type})`);

    const eventRef = ref(database, `webhook_events/stripe_${event.id}`);
    const eventSnapshot = await get(eventRef);
    if (eventSnapshot.exists()) {
      console.log(`Event ${event.id} already processed`);
      return res.status(200).json({ received: true });
    }

    await updateWithRetry(eventRef, {
      processed: true,
      type: event.type,
      createdAt: new Date().toISOString(),
    });

    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        const { transactionId, userId, pointsToAdd } = paymentIntent.metadata;

        if (!transactionId || !userId || !pointsToAdd) {
          console.error(
            "Missing transactionId, userId, or pointsToAdd in payment intent metadata",
            { transactionId, userId, pointsToAdd }
          );
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "Missing metadata",
              eventId: event.id,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(400).json({ error: "Missing metadata" });
        }

        const points = parseInt(pointsToAdd);
        if (isNaN(points) || points <= 0) {
          console.error("Invalid pointsToAdd value", { pointsToAdd });
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: `Invalid pointsToAdd: ${pointsToAdd}`,
              eventId: event.id,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(400).json({ error: "Invalid pointsToAdd" });
        }

        const transactionRef = ref(database, `transactions/${transactionId}`);
        const transactionSnapshot = await get(transactionRef);
        if (!transactionSnapshot.exists()) {
          console.error(`Transaction ${transactionId} not found`);
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "Transaction not found",
              eventId: event.id,
              transactionId,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(404).json({ error: "Transaction not found" });
        }

        const transaction = transactionSnapshot.val();
        if (transaction.status === "completed") {
          console.log(`Transaction ${transactionId} already completed`);
          return res.status(200).json({ received: true });
        }

        await updateWithRetry(transactionRef, {
          status: "completed",
          updatedAt: new Date().toISOString(),
        });

        const userRef = ref(database, `users/${userId}`);
        const userSnapshot = await get(userRef);
        if (userSnapshot.exists()) {
          const currentPoints = userSnapshot.val().points || 0;
          await updateWithRetry(userRef, {
            points: currentPoints + points,
            updatedAt: new Date().toISOString(),
          });
          console.log(
            `Added ${points} points for user ${userId}, new total: ${
              currentPoints + points
            }`
          );
        } else {
          console.error(`User ${userId} not found`);
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "User not found",
              eventId: event.id,
              transactionId,
              userId,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(404).json({ error: "User not found" });
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
          await updateWithRetry(ref(database, `users/${subUserId}`), {
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
    await updateWithRetry(ref(database, `webhook_errors/stripe_${uuidv4()}`), {
      error: error.message,
      signature: sig,
      payloadLength: req.body.length,
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ error: "Webhook error" });
  }
};

// M-Pesa webhook handler
const mpesaWebhook = async (req, res) => {
  try {
    const { Body } = req.body;
    if (!Body || !Body.stkCallback) {
      console.error("Invalid M-Pesa webhook payload", { body: req.body });
      await updateWithRetry(ref(database, `webhook_errors/mpesa_${uuidv4()}`), {
        error: "Invalid webhook payload",
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const { stkCallback } = Body;
    const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

    const eventRef = ref(
      database,
      `webhook_events/mpesa_${Checkout17RequestID}`
    );
    const eventSnapshot = await get(eventRef);
    if (eventSnapshot.exists()) {
      console.log(`M-Pesa event ${CheckoutRequestID} already processed`);
      return res.status(200).json({ received: true });
    }

    const transactionQuery = query(
      ref(database, "transactions"),
      orderByChild("checkoutRequestId"),
      equalTo(CheckoutRequestID)
    );
    const transactionSnapshot = await get(transactionQuery);
    const transactionData = transactionSnapshot.val();
    if (!transactionData) {
      console.error(
        `Transaction with CheckoutRequestID ${CheckoutRequestID} not found`
      );
      await updateWithRetry(ref(database, `webhook_errors/mpesa_${uuidv4()}`), {
        error: "Transaction not found",
        checkoutRequestId: CheckoutRequestID,
        timestamp: new Date().toISOString(),
      });
      return res.status(404).json({ error: "Transaction not found" });
    }

    const transactionId = Object.keys(transactionData)[0];
    const transaction = transactionData[transactionId];

    await updateWithRetry(eventRef, {
      processed: true,
      type: "stkCallback",
      createdAt: new Date().toISOString(),
    });

    if (ResultCode === 0) {
      // Success
      await updateWithRetry(ref(database, `transactions/${transactionId}`), {
        status: "completed",
        updatedAt: new Date().toISOString(),
      });

      const userRef = ref(database, `users/${transaction.userId}`);
      const userSnapshot = await get(userRef);
      if (userSnapshot.exists()) {
        const currentPoints = userSnapshot.val().points || 0;
        const pointsToAdd =
          parseInt(transaction.pointsToAdd) || parseInt(transaction.amount);
        if (isNaN(pointsToAdd) || pointsToAdd <= 0) {
          console.error("Invalid pointsToAdd for M-Pesa transaction", {
            transactionId,
            pointsToAdd,
            amount: transaction.amount,
          });
          await updateWithRetry(
            ref(database, `webhook_errors/mpesa_${uuidv4()}`),
            {
              error: `Invalid pointsToAdd: ${pointsToAdd}`,
              checkoutRequestId: CheckoutRequestID,
              transactionId,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(400).json({ error: "Invalid pointsToAdd" });
        }
        await updateWithRetry(userRef, {
          points: currentPoints + pointsToAdd,
          updatedAt: new Date().toISOString(),
        });
        console.log(
          `Added ${pointsToAdd} points for user ${
            transaction.userId
          }, new total: ${currentPoints + pointsToAdd}`
        );
      } else {
        console.error(`User ${transaction.userId} not found`);
        await updateWithRetry(
          ref(database, `webhook_errors/mpesa_${uuidv4()}`),
          {
            error: "User not found",
            checkoutRequestId: CheckoutRequestID,
            transactionId,
            timestamp: new Date().toISOString(),
          }
        );
        return res.status(404).json({ error: "User not found" });
      }
    } else {
      // Failed
      await updateWithRetry(ref(database, `transactions/${transactionId}`), {
        status: "failed",
        error: ResultDesc,
        updatedAt: new Date().toISOString(),
      });
      console.log(`M-Pesa transaction ${transactionId} failed: ${ResultDesc}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Error processing M-Pesa webhook:", {
      message: error.message,
      stack: error.stack,
    });
    await updateWithRetry(ref(database, `webhook_errors/mpesa_${uuidv4()}`), {
      error: error.message,
      checkoutRequestId: CheckoutRequestID || "unknown",
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ error: "Webhook error" });
  }
};

// Convert existing wallet balance to points
const convertWalletToPoints = async (req, res) => {
  const { userId } = req.body;

  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "Valid userId required" });
  }
  if (userId !== req.user.uid) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const userRef = ref(database, `users/${userId}`);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = snapshot.val();
    if (userData.pointsConverted) {
      return res
        .status(200)
        .json({ message: "Wallet already converted to points" });
    }

    const { amount, currency } = userData.wallet || {
      amount: 0,
      currency: "KES",
    };
    if (amount <= 0) {
      return res.status(200).json({ message: "No wallet balance to convert" });
    }

    // Convert wallet amount directly to points (1:1)
    const pointsToAdd = Math.round(amount);

    // Update user document
    await updateWithRetry(userRef, {
      points: (userData.points || 0) + pointsToAdd,
      wallet: { amount: 0, currency: "KES" },
      pointsConverted: true,
      updatedAt: new Date().toISOString(),
    });

    console.log(`Converted ${pointsToAdd} points for user ${userId}`);

    return res.status(200).json({
      message: `Converted ${amount} ${currency} to ${pointsToAdd} points`,
    });
  } catch (error) {
    console.error("Error converting wallet to points:", {
      message: error.message,
      stack: error.stack,
    });
    await updateWithRetry(ref(database, `webhook_errors/wallet_${uuidv4()}`), {
      error: `Failed to convert wallet: ${error.message}`,
      userId,
      timestamp: new Date().toISOString(),
    });
    return res
      .status(500)
      .json({ error: "Failed to convert wallet to points" });
  }
};

module.exports = {
  createStripePayment,
  createMpesaPayment,
  stripeWebhook,
  mpesaWebhook,
  convertWalletToPoints,
};
