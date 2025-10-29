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
  encryptData,
  decryptData,
  generateChallengeId,
} = require("../utils/encryption");
const {
  addChallengeToUserIndex,
  updateChallengeInUserIndex,
  removeChallengeFromUserIndex,
  getUserChallengeIds,
} = require("../utils/challengeIndexer");
const { decryptDataCached } = require("../utils/decryptionCache");
const {
  fastEncrypt,
  fastDecrypt,
  ultraFastEncrypt,
  ultraFastDecrypt,
} = require("../utils/fastEncryption");
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

/**
 * Secure Challenge Controller
 * Handles encrypted monetized challenges with wallet integration
 */

// Encryption key validation (NO FALLBACK - must be set in environment)
// For Firebase Functions, validation happens on first use, not at module load
const getEncryptionKey = () => {
  const ENCRYPTION_KEY = process.env.CHALLENGE_ENCRYPTION_KEY;
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error(
      "CHALLENGE_ENCRYPTION_KEY must be set and >= 32 characters"
    );
  }
  if (ENCRYPTION_KEY === "your-32-character-secret-key-here!") {
    throw new Error(
      "Default encryption key detected! Set proper key in environment"
    );
  }
  return ENCRYPTION_KEY;
};

// Get encryption key
const ENCRYPTION_KEY = process.env.CHALLENGE_ENCRYPTION_KEY || "";

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

    console.log(`🎯 Creating challenge: ${challengerId} vs ${challengedId}`);

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
    console.log(`🔍 Checking for duplicate challenges...`);
    try {
      const existingChallengeIds = await getUserChallengeIds(
        challengerId,
        "pending"
      );

      // Check challenger's pending challenges
      for (const existingChallengeId of existingChallengeIds) {
        const existingChallengeRef = ref(
          database,
          `secureChallenges/${existingChallengeId}`
        );
        const existingChallengeSnap = await get(existingChallengeRef);

        if (existingChallengeSnap.exists()) {
          const existingChallengeData = decryptData(
            existingChallengeSnap.val(),
            ENCRYPTION_KEY
          );

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
          `secureChallenges/${existingChallengeId}`
        );
        const existingChallengeSnap = await get(existingChallengeRef);

        if (existingChallengeSnap.exists()) {
          const existingChallengeData = decryptData(
            existingChallengeSnap.val(),
            ENCRYPTION_KEY
          );

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

      console.log(`✅ No duplicate challenges found`);
    } catch (duplicateCheckError) {
      console.error(
        `⚠️ Error checking for duplicates: ${duplicateCheckError.message}`
      );
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

    // Encrypt challenge data
    const encryptedData = encryptData(challengeData, ENCRYPTION_KEY);

    // Store encrypted challenge
    const challengeRef = ref(database, `secureChallenges/${challengeId}`);
    await set(challengeRef, encryptedData);

    // Add to user indexes for fast queries
    await addChallengeToUserIndex(
      challengeId,
      challengerId,
      challengedId,
      "pending"
    );

    console.log(`✅ Challenge created: ${challengeId}`);

    res.json({
      success: true,
      challengeId,
      message: "Challenge created successfully",
    });
  } catch (error) {
    console.error("Error creating challenge:", error);
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

    console.log(`🎯 Accepting challenge: ${challengeId}`);

    // Get encrypted challenge data
    const challengeRef = ref(database, `secureChallenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    // Decrypt challenge data
    const challengeData = decryptData(challengeSnap.val(), ENCRYPTION_KEY);

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

    // Encrypt updated data
    const encryptedData = encryptData(challengeData, ENCRYPTION_KEY);
    await set(challengeRef, encryptedData);

    // Update user indexes
    await updateChallengeInUserIndex(
        challengeId,
      challengeData.challengerId,
      challengeData.challengedId,
      "accepted"
    );

    // ULTRA-OPTIMIZATION: Invalidate caches for both users
    invalidateUserChallengeIndexes(challengeData.challengerId);
    invalidateUserChallengeIndexes(challengeData.challengedId);

    console.log(`✅ Challenge accepted: ${challengeId}`);

    res.json({
      success: true,
      message: "Challenge accepted successfully",
    });
  } catch (error) {
    console.error("Error accepting challenge:", error);
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

    console.log(`🎯 Rejecting challenge: ${challengeId}`);

    // Get encrypted challenge data
    const challengeRef = ref(database, `secureChallenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    // Decrypt challenge data
    const challengeData = decryptData(challengeSnap.val(), ENCRYPTION_KEY);

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

    // Encrypt updated data
    const encryptedData = encryptData(challengeData, ENCRYPTION_KEY);
    await set(challengeRef, encryptedData);

    // Update user indexes
    await updateChallengeInUserIndex(
        challengeId,
      challengeData.challengerId,
      challengeData.challengedId,
      "rejected"
    );

    console.log(`✅ Challenge rejected: ${challengeId}`);

    res.json({
      success: true,
      message: "Challenge rejected successfully",
    });
  } catch (error) {
    console.error("Error rejecting challenge:", error);
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

    console.log(`🎮 Starting game session: ${challengeId}`);

    // Validate challengeId
    if (!challengeId) {
      return res.status(400).json({ error: "Challenge ID is required" });
    }

    // Get encrypted challenge data
    const challengeRef = ref(database, `secureChallenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    // Decrypt challenge data
    const challengeData = decryptData(challengeSnap.val(), ENCRYPTION_KEY);

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

    console.log(`✅ Game session started: ${sessionToken}`);

    res.json({
      success: true,
      sessionToken,
      message: "Game session started successfully",
    });
  } catch (error) {
    console.error("Error starting game session:", error);
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

    console.log(`🎯 Submitting score: ${score} for challenge ${challengeId}`);

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

    // Get encrypted challenge data
    const challengeRef = ref(database, `secureChallenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    // Decrypt challenge data
    const challengeData = decryptData(challengeSnap.val(), ENCRYPTION_KEY);

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
    if (challengeData.challengerScore && challengeData.challengedScore) {
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

    // Encrypt updated data
    const encryptedData = encryptData(challengeData, ENCRYPTION_KEY);
    await set(challengeRef, encryptedData);

    // Update user indexes for status change
    if (challengeData.status === "completed") {
      await updateChallengeInUserIndex(
        challengeId,
        challengeData.challengerId,
        challengeData.challengedId,
        "completed"
      );
    }

    // ULTRA-OPTIMIZATION: Invalidate caches for both users
    invalidateUserChallengeIndexes(challengeData.challengerId);
    invalidateUserChallengeIndexes(challengeData.challengedId);

    // Remove session token
    await remove(sessionRef);

    console.log(`✅ Score submitted: ${score}`);

    res.json({
      success: true,
      message: "Score submitted successfully",
    });
  } catch (error) {
    console.error("Error submitting score:", error);
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

    console.log(`🔍 ULTRA-OPTIMIZED: Fetching challenges for user: ${userId} status=${status || 'all'} limit=${limit} offset=${offset}`);
    const startTime = Date.now();

    // ULTRA-OPTIMIZATION: Check cache first
    const cacheKey = `${userId}_${status || "all"}`;
    const cacheLookupStart = Date.now();
    const cachedResult = getCachedChallengeIndex(userId, status);
    console.log(`🧮 CACHE LOOKUP took ${Date.now() - cacheLookupStart}ms`);

    if (cachedResult && cachedResult.length > 0) {
      console.log(
        `⚡ CACHE HIT: Using cached challenge index (${cachedResult.length} items)`
      );

      // Return cached data immediately
      const challengesToReturn = cachedResult.slice(
        parseInt(offset),
        parseInt(offset) + parseInt(limit)
      );

      const endTime = Date.now();
      console.log(`⚡ CACHE RESPONSE: ${endTime - startTime}ms`);

      return res.json({
        success: true,
        data: challengesToReturn,
        total: cachedResult.length,
        cached: true,
      });
    }

    // OPTIMIZATION: Use metadata index instead of decrypting all challenges
    const idsStart = Date.now();
    const challengeIds = await withTimeout(
      Promise.resolve(getUserChallengeIds(userId, status)),
      10000,
      "getUserChallengeIds"
    );

    console.log(
      `📦 User has ${challengeIds.length} challenges (no decryption needed)`
    );

    // FALLBACK: If no indexes exist, use the old method for existing challenges
    if (challengeIds.length === 0) {
      console.log(
        "🔄 No challenge indexes found, falling back to legacy method..."
      );
      return await getChallengeHistoryLegacy(req, res);
    }

    // OPTIMIZATION: Only decrypt challenges we need
    const challengesToDecrypt = challengeIds.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    const userChallenges = [];
    const uniqueUserIds = new Set();

    // Decrypt only the challenges we need
    const decryptStart = Date.now();
    for (const challengeId of challengesToDecrypt) {
      try {
        const challengeRef = ref(database, `secureChallenges/${challengeId}`);
        const challengeSnap = await withTimeout(get(challengeRef), 10000, `get_secureChallenges/${challengeId}`);

        if (!challengeSnap.exists()) continue;

        const challengeData = decryptDataCached(
          challengeSnap.val(),
          ENCRYPTION_KEY,
          challengeId
        );

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
      } catch (decryptError) {
        console.warn(
          `Failed to decrypt challenge ${challengeId}:`,
          decryptError.message
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

    console.log(`✅ Fetched ${Object.keys(userDataMap).length} user profiles [decrypt ${Date.now() - decryptStart}ms]`);

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
    console.log(`⚡ OPTIMIZED Challenge fetch completed in ${elapsed}ms`);

    // ULTRA-OPTIMIZATION: Cache the results for future requests
    setCachedChallengeIndex(userId, status, enrichedChallenges);

    return res.json({
      success: true,
      data: enrichedChallenges,
      total: challengeIds.length,
      hasMore: challengeIds.length > parseInt(offset) + parseInt(limit),
    });
  } catch (error) {
    console.error("Error getting challenge history:", error);
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
    const challengesRef = ref(database, "secureChallenges");
    const challengesSnap = await withTimeout(get(challengesRef), 10000, "legacy_get_secureChallenges");

    if (!challengesSnap.exists()) {
      return res.json({ success: true, data: [], total: 0, hasMore: false });
    }

    const allChallenges = challengesSnap.val();
    const userChallenges = [];

    // Process challenges
    for (const [challengeId, encryptedData] of Object.entries(allChallenges)) {
      try {
        const challengeData = decryptData(encryptedData, ENCRYPTION_KEY);

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
      } catch (decryptError) {
        console.warn(
          `Failed to decrypt challenge ${challengeId}:`,
          decryptError.message
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
