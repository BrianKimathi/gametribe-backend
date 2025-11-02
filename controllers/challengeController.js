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
const {
  getCachedChallenge,
  setCachedChallenge,
  getCachedUser,
  setCachedUser,
  getCachedChallengeIndex,
  setCachedChallengeIndex,
  invalidateChallenge,
  invalidateUser,
  invalidateUserChallengeIndexes,
} = require("../utils/aggressiveCache");
const { createLogger } = require("../utils/logger");
const log = createLogger("challenges");

// Import Socket.IO service for real-time updates
const {
  emitChallengeCreated,
  emitChallengeAccepted,
  emitChallengeRejected,
  emitScoreUpdated,
  emitGameStarted,
  emitChallengeCompleted,
} = require("../services/socketService");

// Import FCM notification service
const {
  sendChallengeCreatedNotification,
  sendChallengeAcceptedNotification,
  sendChallengeRejectedNotification,
  sendChallengeCompletedNotification,
  sendScoreUpdatedNotification,
} = require("../services/fcmService");

/**
 * Challenge Controller
 * Handles monetized challenges with wallet integration and real-time updates
 */

// Generate simple challenge ID
const generateChallengeId = () => {
  return `challenge_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * Create a new challenge
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

    const rid = req.headers["x-request-id"] || `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
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
    if (isNaN(bet) || bet < 20 || bet > 10000) {
      return res.status(400).json({
        error: "Bet amount must be between 20 and 10,000 KES",
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
              existingChallengeData.challengerScore == null &&
              existingChallengeData.challengedScore == null
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
      // This prevents blocking challenge creation due to indexing issues
    }

    // Generate challenge ID
    const challengeId = generateChallengeId();

    // Create challenge data
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

    // Store challenge as plain JSON
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

    // Emit real-time notification to challenged user
    emitChallengeCreated(challengerId, challengedId, challengeData);

    // Send FCM push notification
    sendChallengeCreatedNotification(challengerId, challengedId, challengeData).catch((err) => {
      log.error("FCM notification failed", { error: err.message });
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
 * Accept a challenge
 */
const acceptChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const challengedId = req.user.uid;
    const rid = req.headers["x-request-id"] || `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const started = Date.now();
    log.info("accept:start", { rid, challengeId, challengedId });

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    // Get challenge data
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
    challengeData.status = "accepted";
    challengeData.acceptedAt = Date.now();

    // Save updated data
    await set(challengeRef, challengeData);

    // Update user indexes
    await updateChallengeInUserIndex(
        challengeId,
      challengeData.challengerId,
      challengeData.challengedId,
      "accepted"
    );

    log.info("accept:success", { rid, challengeId, durationMs: Date.now() - started });

    // Emit real-time notification to challenger
    emitChallengeAccepted(
      challengeData.challengerId,
      challengedId,
      challengeData
    );

    // Send FCM push notification
    sendChallengeAcceptedNotification(
      challengeData.challengerId,
      challengedId,
      challengeData
    ).catch((err) => {
      log.error("FCM notification failed", { error: err.message });
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
 * Reject a challenge
 */
const rejectChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const challengedId = req.user.uid;
    const rid = req.headers["x-request-id"] || `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const started = Date.now();
    log.info("reject:start", { rid, challengeId, challengedId });

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    // Get challenge data
    const challengeData = challengeSnap.val();

    // Validate challenge
    if (challengeData.challengedId !== challengedId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (challengeData.status !== "pending") {
      return res.status(400).json({ error: "Challenge is not pending" });
    }

    // Update challenge status
    challengeData.status = "rejected";
    challengeData.rejectedAt = Date.now();

    // Save updated data
    await set(challengeRef, challengeData);

    // Update user indexes
    await updateChallengeInUserIndex(
        challengeId,
      challengeData.challengerId,
      challengeData.challengedId,
      "rejected"
    );

    log.info("reject:success", { rid, challengeId, durationMs: Date.now() - started });

    // Emit real-time notification to challenger
    emitChallengeRejected(
      challengeData.challengerId,
      challengedId,
      challengeData
    );

    // Send FCM push notification
    sendChallengeRejectedNotification(
      challengeData.challengerId,
      challengedId,
      challengeData
    ).catch((err) => {
      log.error("FCM notification failed", { error: err.message });
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
 * Start a game session
 */
const startGameSession = async (req, res) => {
  try {
    const { challengeId } = req.body;
    const userId = req.user.uid;
    const rid = req.headers["x-request-id"] || `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
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

    // Get challenge data
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

    log.info("session:success", { rid, challengeId, sessionToken, durationMs: Date.now() - started });

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
 * Submit challenge score
 */
const submitChallengeScore = async (req, res) => {
  try {
    const { challengeId, score, sessionToken } = req.body;
    const userId = req.user.uid;
    const rid = req.headers["x-request-id"] || `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
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

    // Get challenge data
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
    if (challengeData.challengerId === userId) {
      challengeData.challengerScore = score;
    } else {
      challengeData.challengedScore = score;
    }

    // Check if both scores are submitted
    if (challengeData.challengerScore != null && challengeData.challengedScore != null) {
      challengeData.status = "completed";
      challengeData.completedAt = Date.now();

      // Determine winner
      if (challengeData.challengerScore > challengeData.challengedScore) {
        challengeData.winnerId = challengeData.challengerId;
      } else if (
        challengeData.challengedScore > challengeData.challengerScore
      ) {
        challengeData.winnerId = challengeData.challengedId;
      } else {
        challengeData.winnerId = "tie";
      }
    }

    // Save updated data
    await set(challengeRef, challengeData);

    // Update user indexes for status change
    if (challengeData.status === "completed") {
      await updateChallengeInUserIndex(
        challengeId,
        challengeData.challengerId,
        challengeData.challengedId,
        "completed"
      );
    }

    // Remove session token
    await remove(sessionRef);

    log.info("score:success", { rid, challengeId, score, newStatus: challengeData.status, durationMs: Date.now() - started });

    // Emit real-time score update
    const opponentId = challengeData.challengerId === userId 
      ? challengeData.challengedId 
      : challengeData.challengerId;
    
    emitScoreUpdated(userId, opponentId, challengeId, {
      challengerScore: challengeData.challengerScore,
      challengedScore: challengeData.challengedScore,
      isComplete: challengeData.status === "completed",
    });

    // Send FCM notification for score update (only if not completed yet)
    if (challengeData.status !== "completed") {
      sendScoreUpdatedNotification(opponentId, userId, challengeData).catch((err) => {
        log.error("FCM score notification failed", { error: err.message });
      });
    }

    // If challenge is completed, emit completion event and send notifications
    if (challengeData.status === "completed") {
      emitChallengeCompleted(
        challengeData.challengerId,
        challengeData.challengedId,
        challengeData
      );

      // Send FCM notifications to both players
      sendChallengeCompletedNotification(
        challengeData.challengerId,
        challengeData.challengedId,
        challengeData
      ).catch((err) => {
        log.error("FCM completion notification failed (challenger)", { error: err.message });
      });

      sendChallengeCompletedNotification(
        challengeData.challengedId,
        challengeData.challengerId,
        challengeData
      ).catch((err) => {
        log.error("FCM completion notification failed (challenged)", { error: err.message });
      });
    }

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
 * Get user's challenge history (OPTIMIZED)
 */
// Utility: timeout wrapper to avoid long-hanging awaits
function withTimeout(promise, ms, label = "operation") {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms in ${label}`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

const getChallengeHistory = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { limit = 10, offset = 0, status } = req.query;

  const rid = req.headers["x-request-id"] || `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const startTime = Date.now();
  log.info("history:start", { rid, userId, status: status || "all", limit, offset });

    // OPTIMIZATION: Use metadata index instead of decrypting all challenges
    const idsStart = Date.now();
    const challengeIds = await withTimeout(
      Promise.resolve(getUserChallengeIds(userId, status)),
      10000,
      "getUserChallengeIds"
    );

    log.info("history:ids", { rid, count: challengeIds.length });

    // FALLBACK: If no indexes exist, try fetching directly from challenges
    if (challengeIds.length === 0) {
      console.log(
        "🔄 No challenge indexes found, trying direct challenge fetch..."
      );
      
      // Try to fetch challenges directly by querying the challenges node
      try {
        const challengesRef = ref(database, "challenges");
        const challengesSnapshot = await get(challengesRef);
        
        if (!challengesSnapshot.exists()) {
          log.info("history:no_challenges", { rid });
          return res.json({
            success: true,
            data: [],
            total: 0,
            hasMore: false,
          });
        }

        const allChallenges = challengesSnapshot.val();
        const userChallenges = [];

        // Filter challenges where user is challenger or challenged
        for (const [challengeId, challengeData] of Object.entries(allChallenges)) {
          if (
            challengeData.challengerId === userId ||
            challengeData.challengedId === userId
          ) {
            // Apply status filter if provided
            if (!status || challengeData.status === status) {
              userChallenges.push({
                ...challengeData,
                id: challengeId,
                challengeId: challengeId,
              });
            }
          }
        }

        // Sort by createdAt (newest first)
        userChallenges.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Apply pagination
        const paginatedChallenges = userChallenges.slice(
          parseInt(offset),
          parseInt(offset) + parseInt(limit)
        );

        // Enrich with user data
        const uniqueUserIds = new Set();
        paginatedChallenges.forEach((challenge) => {
          uniqueUserIds.add(challenge.challengerId);
          uniqueUserIds.add(challenge.challengedId);
        });

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
              console.warn(`Failed to fetch user data for ${uid}:`, error.message);
            }
          });
          await Promise.all(userPromises);
        }

        const enrichedChallenges = paginatedChallenges.map((challenge) => {
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

        log.info("history:fallback_success", { rid, items: enrichedChallenges.length });

        return res.json({
          success: true,
          data: enrichedChallenges,
          total: userChallenges.length,
          hasMore: userChallenges.length > parseInt(offset) + parseInt(limit),
        });
      } catch (fallbackError) {
        log.error("history:fallback_error", { error: fallbackError.message });
        // Continue with legacy method
        return await getChallengeHistoryLegacy(req, res);
      }
    }

    // Get only the challenges we need
    const challengesToFetch = challengeIds.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    const userChallenges = [];
    const uniqueUserIds = new Set();

    // Fetch challenges
    const fetchStart = Date.now();
    for (const challengeId of challengesToFetch) {
      try {
        const challengeRef = ref(database, `challenges/${challengeId}`);
        const challengeSnap = await withTimeout(get(challengeRef), 10000, `get_challenges/${challengeId}`);

        if (!challengeSnap.exists()) continue;

        const challengeData = challengeSnap.val();

        // Collect unique user IDs for batch fetching
        uniqueUserIds.add(challengeData.challengerId);
        uniqueUserIds.add(challengeData.challengedId);

        // Store challenge data with both id and challengeId for frontend compatibility
        userChallenges.push({
          id: challengeId, // Frontend expects 'id'
          challengeId: challengeId, // Also include challengeId
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
      } catch (error) {
        console.warn(
          `Failed to fetch challenge ${challengeId}:`,
          error.message
        );
      }
    }

    // OPTIMIZATION: Batch fetch user data
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
          console.warn(`Failed to fetch user data for ${uid}:`, error.message);
        }
      });
      await Promise.all(userPromises);
    }

    log.info("history:users_enriched", { rid, users: Object.keys(userDataMap).length, fetchMs: Date.now() - fetchStart });

    // OPTIMIZATION: Enrich challenges with user data
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
    log.info("history:success", { rid, items: enrichedChallenges.length, tookMs: elapsed });

    // ULTRA-OPTIMIZATION: Cache the results for future requests
    setCachedChallengeIndex(userId, status, enrichedChallenges);

    return res.json({
      success: true,
      data: enrichedChallenges,
      total: challengeIds.length,
      hasMore: challengeIds.length > parseInt(offset) + parseInt(limit),
    });
  } catch (error) {
    log.error("history:error", { error: error.message });
    // Fail-safe: do not hang frontend; return minimal response
    try {
      return res.status(200).json({
        success: true,
        data: [],
        total: 0,
        hasMore: false,
        error: error.message,
      });
    } catch (_) {
      return res.status(500).json({ error: "Failed to get challenge history" });
    }
  }
};

/**
 * Legacy challenge history method (fallback for existing challenges)
 */
const getChallengeHistoryLegacy = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { limit = 10, offset = 0, status } = req.query;

    console.log(`🔍 LEGACY: Fetching challenges for user: ${userId}`);
    const startTime = Date.now();

    // Get all challenges
    const challengesRef = ref(database, "challenges");
    const challengesSnap = await withTimeout(get(challengesRef), 10000, "legacy_get_challenges");

    if (!challengesSnap.exists()) {
      return res.json({ success: true, data: [], total: 0, hasMore: false });
    }

    const allChallenges = challengesSnap.val();
    const userChallenges = [];

    // Process challenges
    for (const [challengeId, challengeData] of Object.entries(allChallenges)) {
      try {
        // Filter user's challenges
        if (
          challengeData.challengerId === userId ||
          challengeData.challengedId === userId
        ) {
          // Filter by status if provided
          if (status && challengeData.status !== status) {
            continue;
          }

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
        }
      } catch (error) {
        console.warn(
          `Failed to process challenge ${challengeId}:`,
          error.message
        );
      }
    }

    // Sort by creation date (newest first) and paginate
    userChallenges.sort((a, b) => b.createdAt - a.createdAt);
    const paginatedChallenges = userChallenges.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    // Enrich with user names (same as main function)
    const uniqueUserIds = new Set();
    paginatedChallenges.forEach((challenge) => {
      uniqueUserIds.add(challenge.challengerId);
      uniqueUserIds.add(challenge.challengedId);
    });

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
          console.warn(`Failed to fetch user data for ${uid}:`, error.message);
        }
      });
      await Promise.all(userPromises);
    }

    // Enrich challenges with user data
    const enrichedChallenges = paginatedChallenges.map((challenge) => {
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
    console.log(`⚡ LEGACY Challenge fetch completed in ${elapsed}ms`);

    res.json({
      success: true,
      data: enrichedChallenges,
      total: userChallenges.length,
      hasMore: userChallenges.length > parseInt(offset) + parseInt(limit),
    });
  } catch (error) {
    console.error("Error getting challenge history (legacy):", error);
    res.status(500).json({
      error: "Failed to get challenge history",
      message: error.message,
    });
  }
};

module.exports = {
  createChallenge,
  acceptChallenge,
  rejectChallenge,
  startGameSession,
  submitChallengeScore,
  getChallengeHistory,
};
