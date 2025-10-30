const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const { initializeStorage, storageUtils } = require("./storageConfig");

// Prefer local service account file, then fall back to environment variables
let serviceAccount;
let serviceProjectId;
try {
  const serviceFilePath = path.join(__dirname, "..", "gametribe_service.json");
  if (fs.existsSync(serviceFilePath)) {
    try {
      const fileBuf = fs.readFileSync(serviceFilePath, "utf8");
      const parsed = JSON.parse(fileBuf);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        serviceAccount = parsed;
        serviceProjectId = parsed.project_id;
        console.log("✅ Loaded service account from file: gametribe_service.json");
      } else {
        console.warn("⚠️ gametribe_service.json missing required fields; falling back to env");
      }
    } catch (e) {
      console.error("❌ Failed to read gametribe_service.json:", e.message);
    }
  }

  // Fall back to environment variables if file not present or invalid
  if (!serviceAccount) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const rawKey = process.env.FIREBASE_PRIVATE_KEY;
    const privateKey = rawKey && rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

    if (projectId && clientEmail && privateKey) {
      serviceAccount = { type: "service_account", project_id: projectId, client_email: clientEmail, private_key: privateKey };
      serviceProjectId = projectId;
      console.log("✅ Loaded service account from split env vars");
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (parsed.project_id && parsed.client_email && parsed.private_key) {
          serviceAccount = parsed;
          serviceProjectId = parsed.project_id;
          console.log("✅ Loaded service account from JSON env");
        } else {
          console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT_JSON missing required fields");
        }
      } catch (e) {
        console.error("❌ Error parsing FIREBASE_SERVICE_ACCOUNT_JSON:", e.message);
      }
    } else {
      console.warn("⚠️ No Firebase Admin credentials found (file or env)");
    }
  }
} catch (error) {
  console.error(
    "❌ Error parsing FIREBASE_SERVICE_ACCOUNT_JSON:",
    error.message
  );
  serviceAccount = undefined;
}

try {
  const derivedDbUrl = serviceProjectId
    ? `https://${serviceProjectId}-default-rtdb.firebaseio.com`
    : undefined;
  const derivedBucket = serviceProjectId ? `${serviceProjectId}.appspot.com` : undefined;

  const appConfig = {
    databaseURL: process.env.FIREBASE_DATABASE_URL || derivedDbUrl || "https://gametibe2025-default-rtdb.firebaseio.com",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || derivedBucket || "gametibe2025.appspot.com",
  };

  // Only add credential if serviceAccount is available
  if (serviceAccount) {
    appConfig.credential = admin.credential.cert(serviceAccount);
  }

  const app = admin.initializeApp(appConfig);

  const auth = admin.auth();
  const database = admin.database(); // Realtime Database

  // Initialize storage with error handling
  const storageBucket = initializeStorage();

  // Create storage object with bucket method
  const storage = {
    bucket: () => storageBucket,
    uploadFile: (file, destination) =>
      storageUtils.uploadFile(storageBucket, file, destination),
    deleteFile: (fileName) => storageUtils.deleteFile(storageBucket, fileName),
    getSignedUrl: (fileName, options) =>
      storageUtils.getSignedUrl(storageBucket, fileName, options),
    isAvailable: () => storageUtils.isStorageAvailable(storageBucket),
  };

  console.log("✅ Firebase Admin SDK initialized successfully");
  console.log(`📊 Database URL: ${appConfig.databaseURL}`);
  console.log(`🪣 Storage available: ${storage.isAvailable()}`);

  // Proactive credential sanity check (non-blocking)
  let adminCredentialHealthy = false;
  let adminCredentialLastCheck = Date.now();
  let adminCredentialLastError = null;
  try {
    const cred = app.options && app.options.credential;
    if (cred && typeof cred.getAccessToken === "function") {
      cred
        .getAccessToken()
        .then((t) => {
          const expIn = t && t.expirationTime ? t.expirationTime - Date.now() : null;
          console.log(
            "🔐 Admin access token acquired",
            expIn ? `(expires in ${Math.round(expIn / 1000)}s)` : ""
          );
          adminCredentialHealthy = true;
          adminCredentialLastCheck = Date.now();
          adminCredentialLastError = null;
        })
        .catch((e) => {
          console.error("❌ Admin credential token fetch failed:", {
            message: e.message,
            code: e.code,
            stack: e.stack,
          });
          console.error(
            "ℹ️ If message contains invalid_grant, check machine time sync and service account key validity."
          );
          adminCredentialHealthy = false;
          adminCredentialLastCheck = Date.now();
          adminCredentialLastError = e && e.message ? e.message : String(e);
        });
    }
  } catch (e) {
    console.warn("⚠️ Skipped admin credential check:", e.message);
  }

  const getAdminHealth = () => ({
    healthy: adminCredentialHealthy,
    lastCheck: adminCredentialLastCheck,
    lastError: adminCredentialLastError,
  });

  module.exports = { auth, storage, database, getAdminHealth };
} catch (error) {
  console.error(
    "❌ config/firebase.js - Error initializing Firebase Admin SDK:",
    {
      message: error.message,
      code: error.code,
      stack: error.stack,
    }
  );

  // Initialize with minimal functionality for graceful degradation
  const auth = admin.auth();
  const database = admin.database();
  const storage = {
    bucket: () => {
      throw new Error("Firebase not initialized");
    },
    uploadFile: () => Promise.reject(new Error("Firebase not initialized")),
    deleteFile: () => Promise.resolve(),
    getSignedUrl: () => Promise.reject(new Error("Firebase not initialized")),
    isAvailable: () => false,
  };

  console.warn(
    "⚠️ Firebase initialized in degraded mode - some features may not work"
  );
  module.exports = { auth, storage, database };
}
