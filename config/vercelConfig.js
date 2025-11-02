// Hardcoded configuration for Vercel deployment
// Non-sensitive defaults are here, sensitive values should be set in Vercel dashboard

module.exports = {
  // Environment
  NODE_ENV: "production",
  
  // CORS Origins - hardcoded for production
  ALLOWED_ORIGINS: [
    "https://hub.gametribe.com",
    "https://gametribe.com",
    "https://gametibe2025.web.app",
    "https://gametibe2025.firebaseapp.com",
    "https://community-gametribe.web.app",
    "https://community-gametribe.firebaseapp.com",
    "http://localhost:5173",
    "http://localhost:5174",
  ].join(","),
  
  // Mobile App
  MOBILE_APP_SECRET: "gametribe-mobile-2025",
  
  // Rate Limiting
  DISABLE_RATE_LIMITING: "false", // Enable rate limiting in production
  
  // Firebase - These will fallback to defaults if not set in Vercel env vars
  // Set these in Vercel Dashboard:
  // FIREBASE_PROJECT_ID
  // FIREBASE_CLIENT_EMAIL
  // FIREBASE_PRIVATE_KEY
  // FIREBASE_DATABASE_URL (optional, will derive from project ID)
  // FIREBASE_STORAGE_BUCKET (optional, will derive from project ID)
  
  // Email - Set these in Vercel Dashboard:
  // EMAIL_SERVICE (default: gmail)
  // EMAIL_USER
  // EMAIL_PASSWORD
  
  // M-Pesa - Set these in Vercel Dashboard:
  // MPESA_CONSUMER_KEY
  // MPESA_CONSUMER_SECRET
  // MPESA_SHORTCODE
  // MPESA_PASSKEY
  // MPESA_CALLBACK_URL
  // MPESA_ENVIRONMENT (sandbox or production)
  
  // Webhook Secret - Set in Vercel Dashboard:
  // WEBHOOK_SECRET (for Stripe/M-Pesa webhooks)
};

