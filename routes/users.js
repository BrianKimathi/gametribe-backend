const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase");
const {
  getUserProfile,
  updateUserProfile,
  getUserClans,
} = require("../controllers/users");

// Middleware to verify Firebase ID token
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// Routes
router.get("/profile", verifyToken, getUserProfile); // Get the user's profile
router.put("/profile", verifyToken, updateUserProfile); // Update the user's profile
router.get("/clans", verifyToken, getUserClans); // Get the user's clans

module.exports = router;
