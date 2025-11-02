const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const {
  createChallenge,
  acceptChallenge,
  rejectChallenge,
  startGameSession,
  submitChallengeScore,
  getChallengeHistory,
} = require("../controllers/challengeController");
const {
  validateChallengeRequest,
  validateScoreSubmission,
  validateWalletBalance,
  antiFraudCheck,
  checkChallengeExpiration,
} = require("../middleware/challengeValidator");
const {
  enforceChallengeRateLimit,
} = require("../middleware/challengeRateLimiter");

/**
 * Challenge Routes
 * All routes require authentication
 */

// Create a new challenge
router.post(
  "/create",
  authenticateToken,
  enforceChallengeRateLimit,
  antiFraudCheck,
  validateChallengeRequest,
  validateWalletBalance,
  createChallenge
);

// Accept a challenge
router.post(
  "/accept/:challengeId",
  authenticateToken,
  enforceChallengeRateLimit,
  antiFraudCheck,
  checkChallengeExpiration,
  acceptChallenge
);

// Reject a challenge
router.post(
  "/reject/:challengeId",
  authenticateToken,
  enforceChallengeRateLimit,
  antiFraudCheck,
  checkChallengeExpiration,
  rejectChallenge
);

// Start game session (required before submitting score)
router.post(
  "/start-session",
  authenticateToken,
  enforceChallengeRateLimit,
  antiFraudCheck,
  startGameSession
);

// Submit challenge score
router.post(
  "/score",
  authenticateToken,
  enforceChallengeRateLimit,
  antiFraudCheck,
  validateScoreSubmission,
  submitChallengeScore
);

// Get user's challenge history
router.get("/history", authenticateToken, getChallengeHistory);

module.exports = router;
