const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const postsRouter = require("./routes/posts");
const clansRouter = require("./routes/clans");
const usersRouter = require("./routes/users");
const eventsRouter = require("./routes/events");
const paymentRouter = require("./routes/payment");
const { stripeWebhook } = require("./controllers/payment");

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    fieldSize: 10 * 1024 * 1024, // 10MB for fields
    parts: 10, // Max 10 parts (fields + files)
  },
});

// Apply CORS
app.use(
  cors({
    origin: ["http://localhost:5173", "https://hub.gametribe.com"],
  })
);

// Define Stripe webhook route FIRST with raw parser
// Stripe webhook route FIRST
app.post(
  "/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    console.log(
      "Webhook middleware: req.body type:",
      typeof req.body,
      "isBuffer:",
      Buffer.isBuffer(req.body)
    );
    next();
  },
  stripeWebhook
);

// Apply global middleware AFTER webhook
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
  console.log(`Received ${req.method} ${req.url}`);
  next();
});

// Mount routes
app.use("/api/posts", postsRouter);
app.use("/api/clans", clansRouter);
app.use("/api/users", usersRouter);
app.use("/api/events", eventsRouter);
app.use("/api/payments", paymentRouter);

app.get("/api/test", (req, res) => {
  res.json({ message: "API is working" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Server error:", {
    message: err.message,
    stack: err.stack,
  });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Multer error: ${err.message}` });
  }
  if (err.message === "Unexpected end of form") {
    return res
      .status(400)
      .json({ error: "Invalid multipart/form-data: Unexpected end of form" });
  }
  res.status(500).json({ error: "Internal server error" });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Safely log registered routes
  const routes =
    app._router && app._router.stack
      ? app._router.stack
          .filter((layer) => layer.route)
          .map((layer) => layer.route.path)
          .join(", ")
      : "No routes registered";
  console.log(`Registered routes: ${routes}`);
});
