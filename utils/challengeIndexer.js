const { database } = require("../config/firebase");
const { ref, get, set, update, remove } = require("firebase/database");

/**
 * Challenge Indexer - Maintains user challenge metadata for fast queries
 * This eliminates the need to decrypt all challenges for filtering
 */

/**
 * Add challenge to user index when created
 */
const addChallengeToUserIndex = async (
  challengeId,
  challengerId,
  challengedId,
  status = "pending"
) => {
  try {
    const timestamp = Date.now();

    // Add to challenger's index
    const challengerRef = ref(
      database,
      `userChallenges/${challengerId}/${challengeId}`
    );
    await set(challengerRef, {
      challengeId,
      status,
      role: "challenger",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add to challenged user's index
    const challengedRef = ref(
      database,
      `userChallenges/${challengedId}/${challengeId}`
    );
    await set(challengedRef, {
      challengeId,
      status,
      role: "challenged",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log(`✅ Added challenge ${challengeId} to user indexes`);
  } catch (error) {
    console.error("Error adding challenge to user index:", error);
    throw error;
  }
};

/**
 * Update challenge status in user index
 */
const updateChallengeInUserIndex = async (
  challengeId,
  challengerId,
  challengedId,
  status
) => {
  try {
    const timestamp = Date.now();

    console.log(`🔄 Updating challenge ${challengeId} status to ${status} for users ${challengerId} and ${challengedId}`);

    // Update challenger's index
    const challengerRef = ref(
      database,
      `userChallenges/${challengerId}/${challengeId}`
    );
    await update(challengerRef, {
      status,
      updatedAt: timestamp,
    });
    console.log(`✅ Updated challenger ${challengerId} index for ${challengeId}`);

    // Update challenged user's index
    const challengedRef = ref(
      database,
      `userChallenges/${challengedId}/${challengeId}`
    );
    await update(challengedRef, {
      status,
      updatedAt: timestamp,
    });
    console.log(`✅ Updated challenged ${challengedId} index for ${challengeId}`);

    console.log(`✅ Updated challenge ${challengeId} status to ${status} for both users`);
  } catch (error) {
    console.error("Error updating challenge in user index:", error);
    throw error;
  }
};

/**
 * Remove challenge from user index when deleted
 */
const removeChallengeFromUserIndex = async (
  challengeId,
  challengerId,
  challengedId
) => {
  try {
    // Remove from challenger's index
    const challengerRef = ref(
      database,
      `userChallenges/${challengerId}/${challengeId}`
    );
    await remove(challengerRef);

    // Remove from challenged user's index
    const challengedRef = ref(
      database,
      `userChallenges/${challengedId}/${challengeId}`
    );
    await remove(challengedRef);

    console.log(`✅ Removed challenge ${challengeId} from user indexes`);
  } catch (error) {
    console.error("Error removing challenge from user index:", error);
    throw error;
  }
};

/**
 * Get user's challenge IDs (fast, no decryption needed)
 */
const getUserChallengeIds = async (userId, status = null) => {
  try {
    const userChallengesRef = ref(database, `userChallenges/${userId}`);
    const snapshot = await get(userChallengesRef);

    if (!snapshot.exists()) {
      return [];
    }

    const userChallenges = snapshot.val();
    let challengeIds = Object.keys(userChallenges);

    // Filter by status if provided
    if (status) {
      challengeIds = challengeIds.filter(
        (challengeId) => userChallenges[challengeId].status === status
      );
    }

    return challengeIds;
  } catch (error) {
    console.error("Error getting user challenge IDs:", error);
    return [];
  }
};

module.exports = {
  addChallengeToUserIndex,
  updateChallengeInUserIndex,
  removeChallengeFromUserIndex,
  getUserChallengeIds,
};
