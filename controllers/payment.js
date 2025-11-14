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
const crypto = require("crypto");
require("dotenv").config();

// Initialize Stripe (guarded for missing key in local/dev)
let stripe = null;
try {
  if (
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_SECRET_KEY !== "undefined"
  ) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  } else {
    console.warn(
      "[Payments] STRIPE_SECRET_KEY not set; Stripe features disabled in this environment."
    );
  }
} catch (e) {
  console.error("[Payments] Failed to initialize Stripe:", e.message);
  stripe = null;
}

// Import M-Pesa configuration utility
const { getMpesaConfig } = require("../utils/mpesaConfig");

// Get M-Pesa configuration
let mpesaConfig = null;
try {
  mpesaConfig = getMpesaConfig();
} catch (error) {
  console.warn("[Payments] M-Pesa configuration not available:", error.message);
}

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
console.log("🔐 Webhook secret status:", {
  hasWebhookSecret: !!webhookSecret,
  webhookSecretLength: webhookSecret?.length || 0,
  webhookSecretPreview: webhookSecret
    ? `${webhookSecret.substring(0, 10)}...`
    : "undefined",
});

// Sanitize input
const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  return input.replace(/[<>]/g, "");
};

// Retry mechanism for database updates
const updateWithRetry = async (ref, data, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      // Add debugging for Firebase ref issues
      if (!ref || !ref._path) {
        console.error("Invalid Firebase ref:", { ref, type: typeof ref });
        throw new Error("Invalid Firebase ref provided");
      }

      await update(ref, data);
      return;
    } catch (error) {
      console.error(`Retry ${i + 1} failed for update:`, {
        message: error.message,
        stack: error.stack,
        refPath: ref?._path?.toString(),
        dataKeys: data ? Object.keys(data) : "no data",
      });
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

// Get transaction status (polled by frontend as fallback) - works for both Stripe and M-Pesa
const getStripeTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    if (!transactionId) {
      return res.status(400).json({ error: "transactionId is required" });
    }

    const transactionRef = ref(database, `transactions/${transactionId}`);
    const snapshot = await get(transactionRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const tx = snapshot.val();

    // Check if this is a completed M-Pesa transaction that hasn't been processed yet
    if (
      tx.status === "completed" &&
      tx.method === "mpesa" &&
      tx.checkoutRequestId
    ) {
      console.log(
        "🔄 Found completed M-Pesa transaction, checking if user was updated:",
        transactionId
      );

      // Check if this transaction was already processed by webhook
      const eventRef = ref(
        database,
        `webhook_events/mpesa_${tx.checkoutRequestId}`
      );
      const eventSnapshot = await get(eventRef);

      if (!eventSnapshot.exists()) {
        console.log(
          "⚠️ M-Pesa webhook never processed this transaction, processing now:",
          transactionId
        );

        // Process the M-Pesa payment completion (fallback for failed webhook)
        const userRef = ref(database, `users/${tx.userId}`);
        const userSnapshot = await get(userRef);

        if (userSnapshot.exists()) {
          const userData = userSnapshot.val();
          const currentPoints = userData.points || 0;
          const currentWallet = userData.wallet || {
            amount: 0,
            currency: "KES",
          };
          const pointsToAdd = parseInt(tx.pointsToAdd) || parseInt(tx.amount);

          if (!isNaN(pointsToAdd) && pointsToAdd > 0) {
            console.log("🔄 Processing M-Pesa fallback payment completion:", {
              transactionId,
              userId: tx.userId,
              currentPoints,
              currentWalletAmount: currentWallet.amount || 0,
              pointsToAdd,
              newPoints: currentPoints + pointsToAdd,
              newWalletAmount: (currentWallet.amount || 0) + pointsToAdd,
            });

            // Update user points and wallet
            await updateWithRetry(userRef, {
              points: currentPoints + pointsToAdd,
              wallet: {
                amount: (currentWallet.amount || 0) + pointsToAdd,
                currency: "KES",
                lastUpdated: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            });

            console.log(
              "✅ M-Pesa fallback: Successfully updated user points and wallet"
            );

            // Mark webhook event as processed to prevent duplicate processing
            await updateWithRetry(eventRef, {
              processed: true,
              type: "stkCallback_fallback",
              transactionId,
              createdAt: new Date().toISOString(),
            });

            // Record points history entry
            const historyId = `deposit_mpesa_${transactionId}`;
            await updateWithRetry(
              ref(database, `pointsHistory/${tx.userId}/${historyId}`),
              {
                id: historyId,
                points: pointsToAdd,
                reason: "DEPOSIT_MPESA_FALLBACK",
                metadata: {
                  checkoutRequestId: tx.checkoutRequestId,
                  transactionId,
                  amount: tx.amount,
                  currency: tx.currency,
                },
                timestamp: new Date().toISOString(),
                previousPoints: currentPoints,
                newPoints: currentPoints + pointsToAdd,
                previousWalletAmount: currentWallet.amount || 0,
                newWalletAmount: (currentWallet.amount || 0) + pointsToAdd,
              }
            );

            console.log("✅ M-Pesa fallback: Payment processing completed");
          }
        }
      } else {
        console.log(
          "✅ M-Pesa webhook already processed this transaction:",
          transactionId
        );
      }
    }

    return res.status(200).json({
      status: tx.status || "pending",
      error: tx.error || null,
      pointsToAdd: tx.pointsToAdd || tx.amount || 0,
      method: tx.method || "unknown",
    });
  } catch (error) {
    console.error("Error getting transaction status:", {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to get transaction status" });
  }
};

// Generate M-Pesa OAuth token
const getMpesaToken = async () => {
  // Define baseUrl outside try block so it's available in error handler
  let baseUrl = "https://sandbox.safaricom.co.ke"; // Default

  try {
    if (!mpesaConfig) {
      throw new Error("M-Pesa configuration not available");
    }

    const auth = Buffer.from(
      `${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`
    ).toString("base64");

    baseUrl =
      mpesaConfig.environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    console.log("🔐 M-Pesa token request details:", {
      baseUrl,
      consumerKey: mpesaConfig.consumerKey,
      consumerSecretLength: mpesaConfig.consumerSecret?.length,
      environment: mpesaConfig.environment,
    });

    const response = await axios.get(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } }
    );

    console.log("✅ M-Pesa token generated successfully");
    return response.data.access_token;
  } catch (error) {
    console.error("❌ Error generating M-Pesa token:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      baseUrl,
      consumerKey: mpesaConfig?.consumerKey || "not set",
      environment: mpesaConfig?.environment || "not set",
      stack: error.stack,
    });
    throw new Error("Failed to generate M-Pesa token");
  }
};

// Create Stripe payment intent
const createStripePayment = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: "Stripe not configured" });
    }

    // Validate and sanitize input
    const { amount, userId, currency = "kes" } = req.body;
    const sanitizedAmount = parseInt(sanitizeInput(amount));
    const sanitizedUserId = sanitizeInput(userId);
    const sanitizedCurrency = sanitizeInput(currency).toLowerCase();

    // Stripe minimum amount validation
    const minimumAmounts = {
      kes: 50, // KES 50 ≈ $0.50 (minimum for Stripe)
      usd: 50, // $0.50
      eur: 50, // €0.50
    };

    if (
      !sanitizedAmount ||
      sanitizedAmount < minimumAmounts[sanitizedCurrency] ||
      sanitizedAmount > 10000 ||
      !Number.isInteger(sanitizedAmount)
    ) {
      return res.status(400).json({
        error: `Amount must be an integer between ${
          minimumAmounts[sanitizedCurrency]
        } and 10,000 ${sanitizedCurrency.toUpperCase()}`,
        minimumAmount: minimumAmounts[sanitizedCurrency],
        currency: sanitizedCurrency.toUpperCase(),
      });
    }
    if (
      !sanitizedUserId ||
      typeof sanitizedUserId !== "string" ||
      sanitizedUserId.length < 10
    ) {
      return res.status(400).json({ error: "Valid User ID is required" });
    }

    // Validate currency
    const allowedCurrencies = ["kes", "usd", "eur"];
    if (!allowedCurrencies.includes(sanitizedCurrency)) {
      return res.status(400).json({ error: "Invalid currency" });
    }

    // Validate user is authenticated and matches the requesting user
    if (req.user?.uid !== sanitizedUserId) {
      return res.status(403).json({ error: "Unauthorized: User ID mismatch" });
    }

    const userRef = ref(database, `users/${sanitizedUserId}`);
    const paymentUserSnapshot = await get(userRef);
    if (!paymentUserSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const transactionId = uuidv4();
    const pointsToAdd = sanitizedAmount; // 1 unit = 1 point, regardless of currency

    // Convert to USD for Stripe (Stripe requires USD for international payments)
    // Approximate conversion rates (you might want to use a real-time API)
    const conversionRates = {
      kes: 0.0065, // 1 KES ≈ $0.0065
      usd: 1.0,
      eur: 1.1, // 1 EUR ≈ $1.1
    };

    const usdAmount = Math.round(
      sanitizedAmount * conversionRates[sanitizedCurrency] * 100
    ); // Convert to cents
    const stripeAmount = Math.max(usdAmount, 50); // Ensure minimum $0.50

    console.log(
      `Stripe payment: ${sanitizedAmount} ${sanitizedCurrency.toUpperCase()} → $${(
        stripeAmount / 100
      ).toFixed(2)} USD`
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount: stripeAmount,
      currency: "usd", // Always use USD for Stripe
      payment_method_types: ["card"],
      metadata: {
        userId: sanitizedUserId,
        transactionId,
        pointsToAdd: pointsToAdd.toString(),
        originalAmount: sanitizedAmount.toString(),
        originalCurrency: sanitizedCurrency.toUpperCase(),
        ipAddress: req.ip || "unknown",
      },
    });

    await updateWithRetry(ref(database, `transactions/${transactionId}`), {
      id: transactionId,
      userId: sanitizedUserId,
      type: "deposit",
      method: "stripe",
      amount: sanitizedAmount,
      currency: sanitizedCurrency.toUpperCase(),
      stripeAmount: stripeAmount,
      stripeCurrency: "USD",
      status: "pending",
      paymentIntentId: paymentIntent.id,
      pointsToAdd,
      ipAddress: req.ip || "unknown",
      userAgent: req.get("User-Agent") || "unknown",
      createdAt: new Date().toISOString(),
    });

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
    if (!mpesaConfig) {
      return res.status(503).json({ error: "M-Pesa not configured" });
    }

    // Validate and sanitize input
    const { amount, phoneNumber, userId, currency = "KES" } = req.body;
    const sanitizedAmount = parseInt(sanitizeInput(amount));
    const sanitizedPhoneNumber = sanitizeInput(phoneNumber);
    const sanitizedUserId = sanitizeInput(userId);
    const sanitizedCurrency = sanitizeInput(currency).toUpperCase();

    if (
      !sanitizedAmount ||
      sanitizedAmount < 1 ||
      sanitizedAmount > 10000 ||
      !Number.isInteger(sanitizedAmount)
    ) {
      return res.status(400).json({
        error: "Amount must be an integer between 1 and 10,000",
      });
    }
    if (
      !sanitizedPhoneNumber ||
      !sanitizedPhoneNumber.match(/^\+254[0-9]{9}$/)
    ) {
      return res.status(400).json({
        error: "Valid phone number is required (e.g., +254712345678)",
      });
    }
    if (
      !sanitizedUserId ||
      typeof sanitizedUserId !== "string" ||
      sanitizedUserId.length < 10
    ) {
      return res.status(400).json({ error: "Valid User ID is required" });
    }

    // Validate user is authenticated and matches the requesting user
    if (req.user?.uid !== sanitizedUserId) {
      return res.status(403).json({ error: "Unauthorized: User ID mismatch" });
    }

    // Validate currency for M-Pesa (only KES supported)
    if (sanitizedCurrency !== "KES") {
      return res
        .status(400)
        .json({ error: "M-Pesa only supports KES currency" });
    }

    const userRef = ref(database, `users/${sanitizedUserId}`);
    const mpesaUserSnapshot = await get(userRef);
    if (!mpesaUserSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const pointsToAdd = sanitizedAmount; // 1 unit = 1 point, regardless of currency
    const token = await getMpesaToken();
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    const password = Buffer.from(
      `${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`
    ).toString("base64");

    const baseUrl =
      mpesaConfig.environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    const response = await axios.post(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: mpesaConfig.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: sanitizedAmount,
        PartyA: sanitizedPhoneNumber.replace("+", ""),
        PartyB: mpesaConfig.shortcode,
        PhoneNumber: sanitizedPhoneNumber.replace("+", ""),
        CallBackURL: mpesaConfig.callbackUrl,
        AccountReference: `GameTribe_${sanitizedUserId}`,
        TransactionDesc: "Deposit to GameTribe Wallet",
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const transactionId = uuidv4();
    await updateWithRetry(ref(database, `transactions/${transactionId}`), {
      id: transactionId,
      userId: sanitizedUserId,
      type: "deposit",
      method: "mpesa",
      amount: sanitizedAmount,
      currency: sanitizedCurrency,
      status: "pending",
      checkoutRequestId: response.data.CheckoutRequestID,
      pointsToAdd,
      phoneNumber: sanitizedPhoneNumber,
      ipAddress: req.ip || "unknown",
      userAgent: req.get("User-Agent") || "unknown",
      createdAt: new Date().toISOString(),
    });

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

// Process Stripe event (used for both normal and test mode)
const processStripeEvent = async (event, res) => {
  try {
    console.log("🎯 Processing Stripe event:", event.type);

    const eventRef = ref(database, `webhook_events/stripe_${event.id}`);
    const eventSnapshot = await get(eventRef);
    if (eventSnapshot.exists()) {
      console.log("✅ Event already processed, skipping");
      return res.status(200).json({ received: true });
    }

    switch (event.type) {
      case "checkout.session.completed":
        console.log("🎉 Processing checkout.session.completed event");
        const checkoutSession = event.data.object;
        console.log("🛒 Checkout session data:", {
          id: checkoutSession.id,
          payment_status: checkoutSession.payment_status,
          amount_total: checkoutSession.amount_total,
          currency: checkoutSession.currency,
          metadata: checkoutSession.metadata,
        });

        // Get metadata from checkout session
        const { userId, amount } = checkoutSession.metadata;

        if (!userId || !amount) {
          console.error("Missing metadata in checkout session", {
            userId,
            amount,
          });
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "Missing checkout session metadata",
              eventId: event.id,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(400).json({ error: "Missing metadata" });
        }

        // Amount directly becomes points (no conversion needed)
        const points = parseInt(amount);
        if (isNaN(points) || points <= 0) {
          console.error("Invalid amount value", { amount });
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: `Invalid amount: ${amount}`,
              eventId: event.id,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(400).json({ error: "Invalid amount" });
        }

        // Find the transaction by checkout session ID
        const transactionsRef = ref(database, "transactions");
        const transactionSnapshot = await get(transactionsRef);
        const allTransactions = transactionSnapshot.val() || {};

        let checkoutTransactionId = null;
        let checkoutTransaction = null;

        for (const [id, tx] of Object.entries(allTransactions)) {
          if (tx.checkoutSessionId === checkoutSession.id) {
            checkoutTransactionId = id;
            checkoutTransaction = tx;
            break;
          }
        }

        if (!checkoutTransaction) {
          console.warn(
            `Transaction with checkoutSessionId ${checkoutSession.id} not found, creating one...`
          );

          // Create transaction if it doesn't exist (race condition handling)
          const transactionId = `stripe_checkout_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

          checkoutTransaction = {
            id: transactionId,
            userId,
            amount: parseInt(amount),
            currency: "KES",
            status: "pending",
            paymentMethod: "stripe",
            checkoutSessionId: checkoutSession.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await updateWithRetry(
            ref(database, `transactions/${transactionId}`),
            checkoutTransaction
          );

          checkoutTransactionId = transactionId;
          console.log("✅ Created missing transaction:", transactionId);
        }

        // Update transaction status
        await updateWithRetry(
          ref(database, `transactions/${checkoutTransactionId}`),
          {
            status: "completed",
            updatedAt: new Date().toISOString(),
          }
        );

        // Update user points and wallet balance
        console.log("🔄 Processing Stripe checkout session completion:", {
          userId,
          amount,
          points,
          checkoutSessionId: checkoutSession.id,
        });

        const userRef = ref(database, `users/${userId}`);
        const userSnapshot = await get(userRef);
        if (userSnapshot.exists()) {
          const userData = userSnapshot.val();
          const currentPoints = userData.points || 0;
          const currentWallet = userData.wallet || {
            amount: 0,
            currency: "KES",
          };

          console.log(
            "🔄 Updating user points and wallet for Stripe payment:",
            {
              userId,
              currentPoints,
              pointsToAdd: points,
              newPoints: currentPoints + points,
              currentWallet: currentWallet.amount,
              walletToAdd: points,
              newWalletAmount: currentWallet.amount + points,
            }
          );

          const updateData = {
            // Points are NOT updated - only earned through social actions
            wallet: {
              amount: currentWallet.amount + points,
              currency: "KES",
            },
            updatedAt: new Date().toISOString(),
          };

          console.log("💾 Backend: Updating user with data:", updateData);
          await updateWithRetry(userRef, updateData);
          console.log(
            "✅ Backend: User wallet updated successfully (points NOT affected)"
          );

          // Record wallet transaction history (NOT points history)
          const transactionHistoryId = `deposit_stripe_checkout_${checkoutTransactionId}`;
          await updateWithRetry(
            ref(
              database,
              `users/${userId}/wallet/transactions/${transactionHistoryId}`
            ),
            {
              id: transactionHistoryId,
              amount: points,
              type: "deposit",
              method: "stripe",
              reason: "DEPOSIT_STRIPE_CHECKOUT",
              metadata: {
                checkoutSessionId: checkoutSession.id,
                transactionId: checkoutTransactionId,
                amount: parseInt(amount),
                currency: checkoutSession.currency,
              },
              timestamp: new Date().toISOString(),
              previousBalance: currentWallet.amount,
              newBalance: currentWallet.amount + points,
            }
          );

          console.log(
            `✅ Successfully processed Stripe checkout for user ${userId}: +${points} points`
          );
          console.log("✅ Successfully updated user points for Stripe payment");
        } else {
          console.error(
            `❌ User ${userId} not found for Stripe checkout processing`
          );
        }
        break;

      case "payment_intent.succeeded":
        console.log("🎉 Processing payment_intent.succeeded event");
        const paymentIntent = event.data.object;
        console.log("💳 Payment Intent data:", {
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
          metadata: paymentIntent.metadata,
        });

        const {
          userId: paymentUserId,
          transactionId: paymentTransactionId,
          pointsToAdd,
        } = paymentIntent.metadata;

        if (!paymentUserId || !paymentTransactionId || !pointsToAdd) {
          console.error("Missing metadata in payment intent", {
            userId: paymentUserId,
            transactionId: paymentTransactionId,
            pointsToAdd,
          });
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "Missing payment intent metadata",
              eventId: event.id,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(400).json({ error: "Missing metadata" });
        }

        const paymentPoints = parseInt(pointsToAdd);
        if (isNaN(paymentPoints) || paymentPoints <= 0) {
          console.error("Invalid pointsToAdd in payment intent", {
            pointsToAdd,
          });
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

        const paymentTransactionRef = ref(
          database,
          `transactions/${paymentTransactionId}`
        );
        const paymentTransactionSnapshot = await get(paymentTransactionRef);
        if (!paymentTransactionSnapshot.exists()) {
          console.error(`Transaction ${paymentTransactionId} not found`);
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "Transaction not found",
              eventId: event.id,
              transactionId: paymentTransactionId,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(404).json({ error: "Transaction not found" });
        }

        const paymentTransaction = paymentTransactionSnapshot.val();
        if (paymentTransaction.status === "completed") {
          console.log(
            `Transaction ${paymentTransactionId} already completed, skipping`
          );
          return res.status(200).json({ received: true });
        }

        await updateWithRetry(paymentTransactionRef, {
          status: "completed",
          updatedAt: new Date().toISOString(),
        });

        const paymentUserRef = ref(database, `users/${paymentUserId}`);
        const paymentUserSnapshot = await get(paymentUserRef);
        if (paymentUserSnapshot.exists()) {
          const paymentUserData = paymentUserSnapshot.val();
          const paymentCurrentPoints = paymentUserData.points || 0;
          const paymentCurrentWallet = paymentUserData.wallet || {
            amount: 0,
            currency: "KES",
          };

          await updateWithRetry(paymentUserRef, {
            points: paymentCurrentPoints + paymentPoints,
            wallet: {
              ...paymentCurrentWallet,
              amount: (paymentCurrentWallet.amount || 0) + paymentPoints,
              currency: "KES",
              lastUpdated: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          });

          const paymentHistoryId = `deposit_stripe_${paymentTransactionId}`;
          await updateWithRetry(
            ref(database, `pointsHistory/${paymentUserId}/${paymentHistoryId}`),
            {
              id: paymentHistoryId,
              points: paymentPoints,
              reason: "DEPOSIT_STRIPE",
              metadata: {
                transactionId: paymentTransactionId,
                paymentIntentId: paymentIntent.id,
                amount: paymentTransaction.amount,
                currency: paymentTransaction.currency,
              },
              timestamp: new Date().toISOString(),
              previousPoints: paymentCurrentPoints,
              newPoints: paymentCurrentPoints + paymentPoints,
              previousWalletAmount: paymentCurrentWallet.amount || 0,
              newWalletAmount:
                (paymentCurrentWallet.amount || 0) + paymentPoints,
            }
          );

          console.log(
            `✅ Successfully processed Stripe payment intent for user ${paymentUserId}: +${paymentPoints} points`
          );
        } else {
          console.error(`User ${paymentUserId} not found`);
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "User not found",
              eventId: event.id,
              transactionId: paymentTransactionId,
              userId: paymentUserId,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(404).json({ error: "User not found" });
        }
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        console.log(`📋 Processing subscription event: ${event.type}`);
        const subscription = event.data.object;
        console.log("📑 Subscription data:", {
          id: subscription.id,
          status: subscription.status,
          customer: subscription.customer,
        });

        const subscriptionUserQuery = ref(database, "users");
        const subscriptionUserSnapshot = await get(
          query(
            subscriptionUserQuery,
            orderByChild("stripeCustomerId"),
            equalTo(subscription.customer)
          )
        );
        if (subscriptionUserSnapshot.exists()) {
          const subUserId = Object.keys(subscriptionUserSnapshot.val())[0];
          await updateWithRetry(ref(database, `users/${subUserId}`), {
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            updatedAt: new Date().toISOString(),
          });
          console.log(
            `✅ Updated subscription status for user ${subUserId}: ${subscription.status}`
          );
        } else {
          console.error(
            `No user found with stripeCustomerId ${subscription.customer}`
          );
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: "No user found for subscription",
              eventId: event.id,
              customerId: subscription.customer,
              timestamp: new Date().toISOString(),
            }
          );
        }
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    // Mark event as processed after successful processing
    await updateWithRetry(eventRef, {
      processed: true,
      type: event.type,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Error processing Stripe event:", {
      message: error.message,
      stack: error.stack,
    });
    await updateWithRetry(ref(database, `webhook_errors/stripe_${uuidv4()}`), {
      error: `Failed to process Stripe event: ${error.message}`,
      eventId: event.id,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ error: "Event processing failed" });
  }
};

// Updated Stripe webhook handler
const stripeWebhook = async (req, res) => {
  try {
    console.log("🔔 Stripe webhook received at", new Date().toISOString());
    console.log("📋 Headers:", req.headers);
    console.log("📦 Body type:", typeof req.body);
    console.log("📦 Body length:", req.body?.length || 0);
    console.log(
      "📦 Body preview:",
      req.body?.toString().substring(0, 200) + "..."
    );

    if (!stripe) {
      console.error("❌ Stripe object is not defined");
      await updateWithRetry(
        ref(database, `webhook_errors/stripe_${uuidv4()}`),
        {
          error: "Stripe object not defined",
          timestamp: new Date().toISOString(),
        }
      );
      return res.status(500).json({ error: "Stripe configuration error" });
    }

    let event;
    try {
      console.log("🔍 Attempting to construct event...");
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        webhookSecret
      );
      console.log("✅ Event constructed successfully:", {
        id: event.id,
        type: event.type,
      });
    } catch (error) {
      console.error("❌ Stripe webhook signature verification failed:", {
        message: error.message,
        stack: error.stack,
      });

      if (process.env.NODE_ENV === "development" || !webhookSecret) {
        console.warn(
          "🔧 DEVELOPMENT MODE: Processing webhook despite signature verification failure"
        );
        try {
          event = JSON.parse(req.body.toString());

          // Double-check deduplication in development mode
          const eventRef = ref(database, `webhook_events/stripe_${event.id}`);
          const eventSnapshot = await get(eventRef);
          if (eventSnapshot.exists()) {
            console.log("✅ Event already processed, skipping", event.id);
            return res.status(200).json({ received: true });
          }

          // Process the event in development mode
          return await processStripeEvent(event, res);
        } catch (parseError) {
          console.error("❌ Failed to parse webhook body:", parseError);
          await updateWithRetry(
            ref(database, `webhook_errors/stripe_${uuidv4()}`),
            {
              error: `Failed to parse webhook body: ${parseError.message}`,
              timestamp: new Date().toISOString(),
            }
          );
          return res.status(400).json({ error: "Invalid webhook payload" });
        }
      } else {
        await updateWithRetry(
          ref(database, `webhook_errors/stripe_${uuidv4()}`),
          {
            error: `Webhook signature verification failed: ${error.message}`,
            stack: error.stack,
            timestamp: new Date().toISOString(),
          }
        );
        return res
          .status(400)
          .json({ error: "Webhook signature verification failed" });
      }
    }

    // Check deduplication for normal path
    const eventRef = ref(database, `webhook_events/stripe_${event.id}`);
    const eventSnapshot = await get(eventRef);
    if (eventSnapshot.exists()) {
      console.log("✅ Event already processed, skipping", event.id);
      return res.status(200).json({ received: true });
    }

    // Process the event (only for successful signature verification)
    return await processStripeEvent(event, res);
  } catch (error) {
    console.error("❌ Stripe webhook error:", {
      message: error.message,
      stack: error.stack,
    });
    await updateWithRetry(ref(database, `webhook_errors/stripe_${uuidv4()}`), {
      error: `Webhook processing failed: ${error.message}`,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};

// M-Pesa webhook signature verification
const verifyMpesaWebhookSignature = (req, res, next) => {
  try {
    const signature = req.headers["x-mpesa-signature"];
    const timestamp = req.headers["x-mpesa-timestamp"];

    if (!signature || !timestamp) {
      console.warn("Missing M-Pesa webhook signature or timestamp");
      return next();
    }

    // TODO: Implement proper M-Pesa signature verification
    next();
  } catch (error) {
    console.error("M-Pesa webhook signature verification error:", error);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }
};

// M-Pesa webhook handler
const mpesaWebhook = async (req, res) => {
  let CheckoutRequestID = "unknown";
  try {
    console.log("🔔 M-Pesa webhook received at", new Date().toISOString());
    console.log("📋 M-Pesa headers:", req.headers);
    console.log("📦 M-Pesa body type:", typeof req.body);
    console.log("📦 M-Pesa body length:", req.body?.length || 0);

    const { Body } = req.body;
    console.log(
      "📄 M-Pesa webhook payload:",
      JSON.stringify(req.body, null, 2)
    );
    if (!Body || !Body.stkCallback) {
      console.error("Invalid M-Pesa webhook payload", { body: req.body });
      await updateWithRetry(ref(database, `webhook_errors/mpesa_${uuidv4()}`), {
        error: "Invalid webhook payload",
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const { stkCallback } = Body;
    const {
      CheckoutRequestID: requestId,
      ResultCode,
      ResultDesc,
    } = stkCallback;
    CheckoutRequestID = requestId;

    const eventRef = ref(database, `webhook_events/mpesa_${CheckoutRequestID}`);
    const eventSnapshot = await get(eventRef);
    if (eventSnapshot.exists()) {
      return res.status(200).json({ received: true });
    }

    const transactionsRef = ref(database, "transactions");
    const transactionSnapshot = await get(transactionsRef);
    const allTransactions = transactionSnapshot.val() || {};

    let transactionId = null;
    let transaction = null;

    for (const [id, tx] of Object.entries(allTransactions)) {
      if (tx.checkoutRequestId === CheckoutRequestID) {
        transactionId = id;
        transaction = tx;
        break;
      }
    }

    if (!transaction) {
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

    await updateWithRetry(eventRef, {
      processed: true,
      type: "stkCallback",
      createdAt: new Date().toISOString(),
    });

    if (ResultCode === 0) {
      // Success
      console.log(
        "✅ M-Pesa payment successful for transaction:",
        transactionId
      );
      console.log("💰 M-Pesa transaction details:", {
        transactionId,
        userId: transaction.userId,
        amount: transaction.amount,
        pointsToAdd: transaction.pointsToAdd || transaction.amount,
      });

      await updateWithRetry(ref(database, `transactions/${transactionId}`), {
        status: "completed",
        updatedAt: new Date().toISOString(),
      });

      const userRef = ref(database, `users/${transaction.userId}`);
      const userSnapshot = await get(userRef);
      if (userSnapshot.exists()) {
        const userData = userSnapshot.val();
        const currentPoints = userData.points || 0;
        const currentWallet = userData.wallet || { amount: 0, currency: "KES" };
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

        // Preserve existing wallet fields (escrowBalance, etc.)
        const currentWalletAmount = currentWallet.amount || 0;
        const currentEscrowBalance = currentWallet.escrowBalance || 0;
        const newWalletAmount = currentWalletAmount + pointsToAdd;

        console.log("🔄 Updating user points and wallet:", {
          userId: transaction.userId,
          currentPoints,
          currentWalletAmount,
          currentEscrowBalance,
          pointsToAdd,
          newPoints: currentPoints + pointsToAdd,
          newWalletAmount,
        });

        // Update wallet using path-based update to preserve all existing fields
        const walletUpdatePath = ref(database, `users/${transaction.userId}/wallet`);
        await updateWithRetry(walletUpdatePath, {
          amount: newWalletAmount,
          // Preserve escrowBalance if it exists, otherwise set to 0
          escrowBalance: currentEscrowBalance,
          currency: currentWallet.currency || "KES",
          lastUpdated: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        
        // Update user's updatedAt timestamp
        await updateWithRetry(userRef, {
          updatedAt: new Date().toISOString(),
        });

        console.log(
          "✅ Successfully updated user wallet for M-Pesa payment (points NOT affected)"
        );

        const transactionHistoryId = `deposit_mpesa_${transactionId}`;
        await updateWithRetry(
          ref(
            database,
            `users/${transaction.userId}/wallet/transactions/${transactionHistoryId}`
          ),
          {
            id: transactionHistoryId,
            amount: pointsToAdd,
            type: "deposit",
            method: "mpesa",
            reason: "DEPOSIT_MPESA",
            metadata: {
              checkoutRequestId: CheckoutRequestID,
              transactionId,
              amount: transaction.amount,
              currency: transaction.currency,
            },
            timestamp: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            previousBalance: currentWalletAmount,
            newBalance: newWalletAmount,
          }
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
      await updateWithRetry(ref(database, `transactions/${transactionId}`), {
        status: "failed",
        error: ResultDesc,
        updatedAt: new Date().toISOString(),
      });
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

// REMOVED: Wallet-to-points conversion feature
// Points and wallet are now completely separate systems
// Points = Earned through social actions only
// Wallet = Purchased with real money, used for challenges only
const convertWalletToPoints = async (req, res) => {
  return res.status(410).json({
    error: "Feature removed: Wallet and points are now separate systems",
    message:
      "Points can only be earned through social actions. Wallet is used for challenges.",
  });
};

// Get user transactions
const getUserTransactions = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { limit = 10, type } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const transactionsRef = ref(database, "transactions");
    const transactionSnapshot = await get(transactionsRef);

    if (!transactionSnapshot.exists()) {
      return res.status(200).json({ transactions: [] });
    }

    const transactionsData = transactionSnapshot.val() || {};

    let transactions = Object.entries(transactionsData)
      .map(([id, tx]) => ({ id, ...tx }))
      .filter((tx) => tx.userId === userId);

    if (type) {
      transactions = transactions.filter((tx) => {
        // For deposit type, include both M-Pesa and Stripe transactions
        // Check BOTH 'method' and 'paymentMethod' fields for compatibility
        if (type === "deposit") {
          return (
            tx.type === "deposit" ||
            tx.method === "stripe" ||
            tx.method === "mpesa" ||
            tx.paymentMethod === "stripe" ||
            tx.paymentMethod === "mpesa"
          );
        }
        // For other types, check both type, method, and paymentMethod
        return (
          tx.type === type || tx.method === type || tx.paymentMethod === type
        );
      });
    }

    transactions = transactions
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, parseInt(limit))
      .map((tx) => ({
        ...tx,
        pointsToAdd: tx.pointsToAdd || tx.amount || 0,
      }));

    return res.status(200).json({ transactions });
  } catch (error) {
    console.error("Error fetching user transactions:", {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
};

// Create Stripe checkout session
const createStripeCheckoutSession = async (req, res) => {
  try {
    const { amount, userId } = req.body;

    if (!amount || !userId) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Amount and userId are required",
      });
    }

    const amountInCents = Math.round(amount * 100);
    if (amountInCents < 50) {
      return res.status(400).json({
        error: "Amount too low",
        message: "Amount must be at least $0.50 (KES 50)",
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `GameTribe Points - ${amount} points`,
              description: `Deposit ${amount} KES for ${amount} points`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${
        process.env.FRONTEND_URL || "http://localhost:5173"
      }/profile?tab=wallet&payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${
        process.env.FRONTEND_URL || "http://localhost:5173"
      }/profile?tab=wallet&payment=cancelled`,
      metadata: {
        userId,
        amount: amount.toString(),
        currency: "KES",
      },
    });

    const transactionId = `stripe_checkout_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const transaction = {
      id: transactionId,
      userId,
      amount: parseInt(amount),
      currency: "KES",
      status: "pending",
      paymentMethod: "stripe",
      checkoutSessionId: session.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await updateWithRetry(
      ref(database, `transactions/${transactionId}`),
      transaction
    );

    res.json({
      sessionId: session.id,
      url: session.url,
      transactionId,
    });
  } catch (error) {
    console.error("Error creating Stripe checkout session:", error);
    return res.status(500).json({
      error: "Failed to create checkout session",
      message: error.message,
    });
  }
};

module.exports = {
  createStripePayment,
  createStripeCheckoutSession,
  createMpesaPayment,
  stripeWebhook,
  mpesaWebhook,
  verifyMpesaWebhookSignature,
  convertWalletToPoints,
  getUserTransactions,
  getStripeTransactionStatus,
  processStripeEvent,
};
