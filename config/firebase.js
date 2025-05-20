const admin = require("firebase-admin");
const serviceAccount = require("../firebase-adminsdk.json");

try {
  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://gametibe2025-default-rtdb.firebaseio.com",
    storageBucket: "gametibe2025.firebasestorage.app",
  });

  const auth = admin.auth();
  const db = admin.firestore();
  const storage = admin.storage();
  const database = admin.database();

  module.exports = { auth, db, storage, database };
} catch (error) {
  console.error("config/firebase.js - Error initializing Firebase Admin SDK:", {
    message: error.message,
    code: error.code,
    stack: error.stack,
  });
  throw error;
}
