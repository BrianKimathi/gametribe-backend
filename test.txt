const { database, storage } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");
const Stripe = require("stripe");
const axios = require("axios");

// Initialize Stripe with hardcoded secret key
const stripe = new Stripe(
  "sk_test_51RV7sc4CUfqU3hx8AgfyRjHvdNFQBYtQy69Sotq2p0WijBkKque6zxu2uLvenAfzGll8tHBSNYFXZ5i1Ki8Yfwj100kvHQApGV"
);

// M-Pesa credentials
const MPESA_CONSUMER_KEY = "erQnAIqD2oPUbsiQ2FGXv9mLUEiDBRsQKgfOG8akhHpl9FOF";
const MPESA_CONSUMER_SECRET =
  "eCxVfajTfU7rfHU4B1UTFBP1nKW1TGqvaHZRMRFuK3aFCTm90DnUe3C8ajoTCwT4";
const MPESA_SHORTCODE = "174379"; // Replace with your actual shortcode
const MPESA_PASSKEY =
  "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919"; // Replace with your actual passkey

// Sanitize input to prevent XSS or invalid data
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
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("Error generating M-Pesa token:", error.message, error.stack);
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

    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Convert to cents
      currency: "kes",
      payment_method_types: ["card"],
      metadata: { userId },
    });

    const transactionId = uuidv4();
    await database.ref(`transactions/${transactionId}`).set({
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
    console.error("Error creating Stripe payment:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to create Stripe payment" });
  }
};

// Create M-Pesa STK Push payment
const createMpesaPayment = async (req, res) => {
  try {
    const { amount, phoneNumber, userId } = req.body;
    if (!amount || amount < 100 || amount > 10000) {
      return res
        .status(400)
        .json({ error: "Amount must be between KSH 100 and KSH 10,000" });
    }
    if (!phoneNumber || !phoneNumber.match(/^\+254[0-9]{9}$/)) {
      return res
        .status(400)
        .json({
          error: "Valid phone number is required (e.g., +254712345678)",
        });
    }
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
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
        CallBackURL: "https://your-domain.com/api/payments/mpesa/webhook", // Replace with your actual domain
        AccountReference: `GameTribe_${userId}`,
        TransactionDesc: "Deposit to GameTribe Wallet",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const transactionId = uuidv4();
    await database.ref(`transactions/${transactionId}`).set({
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

    return res.status(200).json({
      transactionId,
      checkoutRequestId: response.data.CheckoutRequestID,
    });
  } catch (error) {
    console.error("Error creating M-Pesa payment:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to create M-Pesa payment" });
  }
};

// Stripe webhook handler
const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_secret"; // Replace with your actual webhook secret

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const transactionId = paymentIntent.metadata.transactionId;
      const userId = paymentIntent.metadata.userId;

      const transactionRef = database.ref(`transactions/${transactionId}`);
      const transactionSnapshot = await transactionRef.once("value");
      if (!transactionSnapshot.exists()) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      await transactionRef.update({
        status: "completed",
        updatedAt: new Date().toISOString(),
      });

      const userRef = database.ref(`users/${userId}`);
      const userSnapshot = await userRef.once("value");
      if (userSnapshot.exists()) {
        const userData = userSnapshot.val();
        const newBalance = (userData.balance || 0) + paymentIntent.amount / 100;
        await userRef.update({ balance: newBalance });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(
      "Error processing Stripe webhook:",
      error.message,
      error.stack
    );
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
