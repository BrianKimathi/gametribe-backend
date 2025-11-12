const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const {
  createChallenge,
  acceptChallenge,
  rejectChallenge,
  startGameSession,
  submitChallengeScore,
} = require("../controllers/challengeController");
// Use V2 getChallengeHistory (with enhanced logging)
const { getChallengeHistory } = require("../controllers/challengeControllerV2");
// Use V2 cancel (implemented here)
const { cancelChallenge } = require("../controllers/challengeControllerV2");
const {
  addReaction,
  getReactions,
} = require("../controllers/challengeReactionsController");
const {
  sendMessage,
  getMessages,
} = require("../controllers/challengeMessagesController");
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

// Challenge reactions (must be before /:challengeId route)
router.post("/:challengeId/reactions", authenticateToken, addReaction);
router.get("/:challengeId/reactions", authenticateToken, getReactions);

// Challenge messages (in-game chat) (must be before /:challengeId route)
router.post("/:challengeId/messages", authenticateToken, sendMessage);
router.get("/:challengeId/messages", authenticateToken, getMessages);

// Cancel a pending challenge (only challenger) - must be last
router.delete("/:challengeId", authenticateToken, cancelChallenge);

module.exports = router;
