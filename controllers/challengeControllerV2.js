const crypto = require("crypto");
const { database } = require("../config/firebase");
const admin = require("firebase-admin");
const {
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue,
  off,
  query,
  orderByChild,
  equalTo,
} = require("firebase/database");
const {
  validateChallengeRequest,
} = require("../middleware/challengeValidator");
const {
  addChallengeToUserIndex,
  updateChallengeInUserIndex,
  removeChallengeFromUserIndex,
  getUserChallengeIds,
} = require("../utils/challengeIndexer");
const { createLogger } = require("../utils/logger");
const log = createLogger("challenges");

/**
 * Challenge Controller V2 - No Encryption
 * Optimized for real-time performance
 */

// Generate a secure challenge ID
const generateChallengeId = () => {
  return crypto.randomBytes(16).toString("hex");
};

/**
 * Create a new challenge (NO ENCRYPTION)
 */
const createChallenge = async (req, res) => {
  try {
    const {
      challengedId,
      gameId,
      gameTitle,
      gameImage,
      gameUrl,
      betAmount,
      message,
    } = req.body;
    const challengerId = req.user.uid;

    const rid =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    log.info("create:start", {
      rid,
      challengerId,
      challengedId,
      gameId,
      betAmount,
    });

    // Validate required fields
    if (!challengedId || !gameId || !gameTitle || !betAmount) {
      return res.status(400).json({
        error:
          "Missing required fields: challengedId, gameId, gameTitle, betAmount",
      });
    }

    // Validate bet amount
    const bet = parseInt(betAmount);
    if (isNaN(bet) || bet < 10 || bet > 10000) {
      return res.status(400).json({
        error: "Bet amount must be between 10 and 10,000 KES",
      });
    }

    // Check if user is challenging themselves
    if (challengerId === challengedId) {
      return res.status(400).json({
        error: "Cannot challenge yourself",
      });
    }

    // DUPLICATE PREVENTION: Check for existing pending/accepted challenges between these users
    log.debug("create:duplicate_check:start", { rid });
    try {
      const existingChallengeIds = await getUserChallengeIds(
        challengerId,
        "pending"
      );

      // Check challenger's pending challenges
      for (const existingChallengeId of existingChallengeIds) {
        const existingChallengeRef = ref(
          database,
          `challenges/${existingChallengeId}`
        );
        const existingChallengeSnap = await get(existingChallengeRef);

        if (existingChallengeSnap.exists()) {
          const existingChallengeData = existingChallengeSnap.val();

          // Check if this is a challenge with the same opponent and game
          if (
            (existingChallengeData.challengerId === challengerId &&
              existingChallengeData.challengedId === challengedId) ||
            (existingChallengeData.challengerId === challengedId &&
              existingChallengeData.challengedId === challengerId)
          ) {
            if (
              existingChallengeData.gameId === gameId &&
              existingChallengeData.status === "pending"
            ) {
              return res.status(409).json({
                error:
                  "A pending challenge already exists with this opponent for this game",
                existingChallengeId: existingChallengeId,
              });
            }
          }
        }
      }

      // Also check challenger's accepted challenges
      const acceptedChallengeIds = await getUserChallengeIds(
        challengerId,
        "accepted"
      );

      for (const existingChallengeId of acceptedChallengeIds) {
        const existingChallengeRef = ref(
          database,
          `challenges/${existingChallengeId}`
        );
        const existingChallengeSnap = await get(existingChallengeRef);

        if (existingChallengeSnap.exists()) {
          const existingChallengeData = existingChallengeSnap.val();

          // Check if this is an accepted challenge with the same opponent
          if (
            (existingChallengeData.challengerId === challengerId &&
              existingChallengeData.challengedId === challengedId) ||
            (existingChallengeData.challengerId === challengedId &&
              existingChallengeData.challengedId === challengerId)
          ) {
            // Allow only if at least one player has submitted their score
            if (
              !existingChallengeData.challengerScore &&
              !existingChallengeData.challengedScore
            ) {
              return res.status(409).json({
                error:
                  "An active challenge already exists with this opponent. Please complete it first.",
                existingChallengeId: existingChallengeId,
              });
            }
          }
        }
      }

      log.info("create:duplicate_check:ok", { rid });
    } catch (duplicateCheckError) {
      log.warn("create:duplicate_check:error", {
        rid,
        error: duplicateCheckError.message,
      });
      // Continue with challenge creation even if duplicate check fails
    }

    // Generate challenge ID
    const challengeId = generateChallengeId();

    // Create challenge data (NO ENCRYPTION)
    const challengeData = {
      challengeId,
      challengerId,
      challengedId,
      gameId,
      gameTitle,
      gameImage: gameImage || "",
      gameUrl: gameUrl || "",
      betAmount: bet,
      message: message || "",
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };

    // Store challenge directly (unencrypted)
    const challengeRef = ref(database, `challenges/${challengeId}`);
    await set(challengeRef, challengeData);

    // Add to user indexes for fast queries
    await addChallengeToUserIndex(
      challengeId,
      challengerId,
      challengedId,
      "pending"
    );

    log.info("create:success", {
      rid,
      challengeId,
      durationMs: Date.now() - started,
    });

    res.json({
      success: true,
      challengeId,
      message: "Challenge created successfully",
    });
  } catch (error) {
    log.error("create:error", { error: error.message });
    res.status(500).json({
      error: "Failed to create challenge",
      message: error.message,
    });
  }
};

/**
 * Accept a challenge (NO ENCRYPTION)
 */
const acceptChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const challengedId = req.user.uid;
    const rid =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    log.info("accept:start", { rid, challengeId, challengedId });

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    // Validate challenge
    if (challengeData.challengedId !== challengedId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (challengeData.status !== "pending") {
      return res.status(400).json({ error: "Challenge is not pending" });
    }

    if (Date.now() > challengeData.expiresAt) {
      return res.status(400).json({ error: "Challenge has expired" });
    }

    // Update challenge status
    await update(challengeRef, {
      status: "accepted",
      acceptedAt: Date.now(),
    });

    // Update user indexes
    await updateChallengeInUserIndex(
      challengeId,
      challengeData.challengerId,
      challengeData.challengedId,
      "accepted"
    );

    log.info("accept:success", {
      rid,
      challengeId,
      durationMs: Date.now() - started,
    });

    res.json({
      success: true,
      message: "Challenge accepted successfully",
    });
  } catch (error) {
    log.error("accept:error", { error: error.message });
    res.status(500).json({
      error: "Failed to accept challenge",
      message: error.message,
    });
  }
};

/**
 * Reject a challenge (NO ENCRYPTION)
 */
const rejectChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const challengedId = req.user.uid;
    const rid =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    log.info("reject:start", { rid, challengeId, challengedId });

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    // Validate challenge
    if (challengeData.challengedId !== challengedId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (challengeData.status !== "pending") {
      return res.status(400).json({ error: "Challenge is not pending" });
    }

    // Update challenge status
    await update(challengeRef, {
      status: "rejected",
      rejectedAt: Date.now(),
    });

    // Update user indexes
    await updateChallengeInUserIndex(
      challengeId,
      challengeData.challengerId,
      challengeData.challengedId,
      "rejected"
    );

    log.info("reject:success", {
      rid,
      challengeId,
      durationMs: Date.now() - started,
    });

    res.json({
      success: true,
      message: "Challenge rejected successfully",
    });
  } catch (error) {
    log.error("reject:error", { error: error.message });
    res.status(500).json({
      error: "Failed to reject challenge",
      message: error.message,
    });
  }
};

/**
 * Cancel a challenge (NO ENCRYPTION)
 */
const cancelChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const challengerId = req.user.uid;
    const rid =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    log.info("cancel:start", { rid, challengeId, challengerId });

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    // Validate challenge
    if (challengeData.challengerId !== challengerId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (challengeData.status !== "pending") {
      return res.status(400).json({ error: "Challenge is not pending" });
    }

    // Update challenge status
    await update(challengeRef, {
      status: "cancelled",
      cancelledAt: Date.now(),
    });

    // Update user indexes
    await updateChallengeInUserIndex(
      challengeId,
      challengeData.challengerId,
      challengeData.challengedId,
      "cancelled"
    );

    log.info("cancel:success", {
      rid,
      challengeId,
      durationMs: Date.now() - started,
    });

    res.json({
      success: true,
      message: "Challenge cancelled successfully",
    });
  } catch (error) {
    log.error("cancel:error", { error: error.message });
    res.status(500).json({
      error: "Failed to cancel challenge",
      message: error.message,
    });
  }
};

/**
 * Start a game session
 */
const startGameSession = async (req, res) => {
  try {
    const { challengeId } = req.body;
    const userId = req.user.uid;
    const rid =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    log.info("session:start", { rid, challengeId, userId });

    // Validate challengeId
    if (!challengeId) {
      return res.status(400).json({ error: "Challenge ID is required" });
    }

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    // Validate challenge
    if (
      challengeData.challengerId !== userId &&
      challengeData.challengedId !== userId
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (challengeData.status !== "accepted") {
      return res.status(400).json({
        error: "Challenge is not accepted",
        currentStatus: challengeData.status,
        message:
          "Please ensure the challenge has been accepted before starting the game",
      });
    }

    // Generate session token
    const sessionToken = crypto.randomBytes(32).toString("hex");

    // Store session token
    const sessionRef = ref(database, `gameSessions/${sessionToken}`);
    await set(sessionRef, {
      challengeId,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    });

    log.info("session:success", {
      rid,
      challengeId,
      sessionToken,
      durationMs: Date.now() - started,
    });

    res.json({
      success: true,
      sessionToken,
      message: "Game session started successfully",
    });
  } catch (error) {
    log.error("session:error", { error: error.message });
    res.status(500).json({
      error: "Failed to start game session",
      message: error.message,
    });
  }
};

/**
 * Submit challenge score (NO ENCRYPTION)
 */
const submitChallengeScore = async (req, res) => {
  try {
    const { challengeId, score, sessionToken } = req.body;
    const userId = req.user.uid;
    const rid =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    log.info("score:start", { rid, challengeId, score, userId });

    // Validate session token
    const sessionRef = ref(database, `gameSessions/${sessionToken}`);
    const sessionSnap = await get(sessionRef);

    if (!sessionSnap.exists()) {
      return res.status(403).json({
        error: "Invalid or expired game session",
        message: "Please restart the game to get a new session token",
      });
    }

    const sessionData = sessionSnap.val();
    if (
      sessionData.userId !== userId ||
      sessionData.challengeId !== challengeId
    ) {
      return res.status(403).json({
        error: "Invalid session",
        message:
          "Session token does not match this challenge. Please restart the game.",
      });
    }

    if (Date.now() > sessionData.expiresAt) {
      return res.status(403).json({
        error: "Session expired",
        message: "Game session has expired. Please restart the game.",
      });
    }

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    // Validate challenge
    if (
      challengeData.challengerId !== userId &&
      challengeData.challengedId !== userId
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (challengeData.status !== "accepted") {
      return res.status(400).json({ error: "Challenge is not accepted" });
    }

    // Update challenge with score
    const updates = {};
    if (challengeData.challengerId === userId) {
      updates.challengerScore = score;
    } else {
      updates.challengedScore = score;
    }

    // Check if both scores are submitted
    const newChallengerScore =
      updates.challengerScore ?? challengeData.challengerScore;
    const newChallengedScore =
      updates.challengedScore ?? challengeData.challengedScore;

    if (newChallengerScore != null && newChallengedScore != null) {
      updates.status = "completed";
      updates.completedAt = Date.now();

      // Determine winner
      if (newChallengerScore > newChallengedScore) {
        updates.winnerId = challengeData.challengerId;
      } else if (newChallengedScore > newChallengerScore) {
        updates.winnerId = challengeData.challengedId;
      } else {
        updates.winnerId = "tie";
      }
    }

    // Update challenge data
    await update(challengeRef, updates);

    // Update user indexes for status change
    if (updates.status === "completed") {
      await updateChallengeInUserIndex(
        challengeId,
        challengeData.challengerId,
        challengeData.challengedId,
        "completed"
      );
    }

    // Remove session token
    await remove(sessionRef);

    log.info("score:success", {
      rid,
      challengeId,
      score,
      newStatus: updates.status,
      durationMs: Date.now() - started,
    });

    res.json({
      success: true,
      message: "Score submitted successfully",
    });
  } catch (error) {
    log.error("score:error", { error: error.message });
    res.status(500).json({
      error: "Failed to submit score",
      message: error.message,
    });
  }
};

/**
 * Get challenge history (NO ENCRYPTION - OPTIMIZED)
 */
const getChallengeHistory = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { limit = 10, offset = 0, status } = req.query;

    const rid =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();
    log.info("history:start", {
      rid,
      userId,
      status: status || "all",
      limit,
      offset,
    });

    // Get user's challenge IDs from index
    const challengeIds = await getUserChallengeIds(userId, status);
    log.info("history:ids", { rid, count: challengeIds.length });

    // Only decrypt challenges we need
    const challengesToFetch = challengeIds.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    const userChallenges = [];
    const uniqueUserIds = new Set();

    // Fetch only the challenges we need
    for (const challengeId of challengesToFetch) {
      try {
        const challengeRef = ref(database, `challenges/${challengeId}`);
        const challengeSnap = await get(challengeRef);

        if (!challengeSnap.exists()) continue;

        const challengeData = challengeSnap.val();

        // Collect unique user IDs for batch fetching
        uniqueUserIds.add(challengeData.challengerId);
        uniqueUserIds.add(challengeData.challengedId);

        // Store minimal challenge data
        userChallenges.push({
          challengeId: challengeData.challengeId,
          challengerId: challengeData.challengerId,
          challengedId: challengeData.challengedId,
          gameId: challengeData.gameId,
          gameTitle: challengeData.gameTitle,
          gameImage: challengeData.gameImage,
          gameUrl: challengeData.gameUrl,
          betAmount: challengeData.betAmount,
          status: challengeData.status,
          createdAt: challengeData.createdAt,
          completedAt: challengeData.completedAt,
          winnerId: challengeData.winnerId,
          challengerScore: challengeData.challengerScore,
          challengedScore: challengeData.challengedScore,
          isChallenger: challengeData.challengerId === userId,
          opponentId:
            challengeData.challengerId === userId
              ? challengeData.challengedId
              : challengeData.challengerId,
        });
      } catch (fetchError) {
        console.warn(
          `Failed to fetch challenge ${challengeId}:`,
          fetchError.message
        );
      }
    }

    // Batch fetch user data
    const userDataMap = {};
    if (uniqueUserIds.size > 0) {
      const userPromises = Array.from(uniqueUserIds).map(async (uid) => {
        try {
          const userRef = ref(database, `users/${uid}`);
          const userSnap = await get(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.val();
            userDataMap[uid] = {
              displayName:
                userData.displayName || userData.username || "Unknown Player",
              photoURL: userData.photoURL || userData.avatar || "",
            };
          }
        } catch (error) {
          console.warn(
            `Failed to fetch user data for ${uid}:`,
            error.message
          );
        }
      });
      await Promise.all(userPromises);
    }

    log.info("history:users_enriched", {
      rid,
      users: Object.keys(userDataMap).length,
    });

    // Enrich challenges with user data
    const enrichedChallenges = userChallenges.map((challenge) => {
      const challengerData = userDataMap[challenge.challengerId] || {};
      const challengedData = userDataMap[challenge.challengedId] || {};

      return {
        ...challenge,
        challengerName: challengerData.displayName || "Unknown Player",
        challengedName: challengedData.displayName || "Unknown Player",
        challengerAvatar: challengerData.photoURL || "",
        challengedAvatar: challengedData.photoURL || "",
      };
    });

    const elapsed = Date.now() - startTime;
    log.info("history:success", {
      rid,
      items: enrichedChallenges.length,
      tookMs: elapsed,
    });

    return res.json({
      success: true,
      data: enrichedChallenges,
      total: challengeIds.length,
      hasMore: challengeIds.length > parseInt(offset) + parseInt(limit),
    });
  } catch (error) {
    log.error("history:error", { error: error.message });
    return res.status(500).json({
      error: "Failed to get challenge history",
      message: error.message,
    });
  }
};

/**
 * Get single challenge details (NO ENCRYPTION)
 */
const getChallengeDetails = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.uid;

    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    // Validate authorization
    if (
      challengeData.challengerId !== userId &&
      challengeData.challengedId !== userId
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Fetch user data for both players
    const uniqueUserIds = new Set([
      challengeData.challengerId,
      challengeData.challengedId,
    ]);
    const userDataMap = {};

    for (const uid of uniqueUserIds) {
      try {
        const userRef = ref(database, `users/${uid}`);
        const userSnap = await get(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.val();
          userDataMap[uid] = {
            displayName:
              userData.displayName || userData.username || "Unknown Player",
            photoURL: userData.photoURL || userData.avatar || "",
          };
        }
      } catch (error) {
        console.warn(`Failed to fetch user data for ${uid}:`, error.message);
      }
    }

    // Enrich challenge with user data
    const enrichedChallenge = {
      ...challengeData,
      challengerName:
        userDataMap[challengeData.challengerId]?.displayName || "Unknown Player",
      challengedName:
        userDataMap[challengeData.challengedId]?.displayName || "Unknown Player",
      challengerAvatar: userDataMap[challengeData.challengerId]?.photoURL || "",
      challengedAvatar: userDataMap[challengeData.challengedId]?.photoURL || "",
    };

    res.json({
      success: true,
      challenge: enrichedChallenge,
    });
  } catch (error) {
    log.error("details:error", { error: error.message });
    res.status(500).json({
      error: "Failed to get challenge details",
      message: error.message,
    });
  }
};

module.exports = {
  createChallenge,
  acceptChallenge,
  rejectChallenge,
  cancelChallenge,
  startGameSession,
  submitChallengeScore,
  getChallengeHistory,
  getChallengeDetails,
};




