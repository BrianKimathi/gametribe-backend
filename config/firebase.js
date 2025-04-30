const admin = require("firebase-admin");

// Load the service account key
let serviceAccount;
try {
  serviceAccount = require("../firebase-adminsdk.json");
} catch (error) {
  console.error("Failed to load Firebase service account key:", error.message);
  process.exit(1); // Exit the process if the service account key is missing
}

// Validate environment variables
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
if (!storageBucket) {
  console.error("FIREBASE_STORAGE_BUCKET environment variable is not set.");
  process.exit(1); // Exit the process if the storage bucket is not set
}

// Initialize Firebase Admin SDK
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: storageBucket,
  });
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("Failed to initialize Firebase Admin SDK:", error.message);
  process.exit(1); // Exit the process if initialization fails
}

// Initialize Firestore and Storage
const db = admin.firestore();
const storage = admin.storage();

console.log();

// Optional: Configure Firestore settings (e.g., timestampsInSnapshots)
db.settings({ ignoreUndefinedProperties: true });

module.exports = { db, storage, admin };
