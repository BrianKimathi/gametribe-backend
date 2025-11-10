const { database } = require("../config/firebase");
const { ref, get, set, remove, push } = require("firebase/database");
const { createLogger } = require("../utils/logger");
const { emitChallengeReaction } = require("../services/socketService");
const { createNotification } = require("./notificationController");
const log = createLogger("challenge-reactions");

/**
 * Add a reaction to a challenge
 */
const addReaction = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { reaction } = req.body; // e.g., "👍", "🔥", "🎮", "💪"
    const userId = req.user.uid;
    const userName = req.user.name || req.user.displayName || "User";
    const userAvatar = req.user.picture || req.user.photoURL || "";

    if (!reaction || !reaction.trim() || !challengeId) {
      return res
        .status(400)
        .json({ error: "Missing reaction or challengeId" });
    }

    const normalizedReaction = reaction.trim();

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    const allowedStatuses = ["accepted", "completed"];
    if (!allowedStatuses.includes((challengeData.status || "").toLowerCase())) {
      return res.status(400).json({
        error: "Reactions are only available after a challenge is accepted",
      });
    }

    // Verify user is part of this challenge
    if (
      challengeData.challengerId !== userId &&
      challengeData.challengedId !== userId
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Initialize reactions object if it doesn't exist
    const reactionsRef = ref(
      database,
      `challenges/${challengeId}/reactions`
    );
    const reactionsSnap = await get(reactionsRef);
    const rawReactions = reactionsSnap.exists() ? reactionsSnap.val() : {};

    const reactions = Object.entries(rawReactions).reduce(
      (acc, [emoji, value]) => {
        let entries = [];
        if (Array.isArray(value)) {
          entries = value.filter((item) => item && typeof item === "object");
        } else if (value && typeof value === "object") {
          entries = Object.values(value).filter(
            (item) => item && typeof item === "object"
          );
        }

        if (entries.length > 0) {
          acc[emoji] = entries.map((entry) => ({
            userId: entry.userId || "",
            userName: entry.userName || "",
            userAvatar: entry.userAvatar || "",
            timestamp: entry.timestamp || Date.now(),
          }));
        }

        return acc;
      },
      {}
    );

    const opponentId =
      challengeData.challengerId === userId
        ? challengeData.challengedId
        : challengeData.challengerId;

    // Initialize reaction array if it doesn't exist
    reactions[normalizedReaction] = reactions[normalizedReaction] || [];

    // Check if user already reacted with this emoji
    const existingIndex = reactions[normalizedReaction].findIndex(
      (r) => r.userId === userId
    );

    if (existingIndex >= 0) {
      // User already reacted, remove the reaction
      reactions[normalizedReaction].splice(existingIndex, 1);
      if (reactions[normalizedReaction].length === 0) {
        delete reactions[normalizedReaction];
      }

      if (Object.keys(reactions).length === 0) {
        await remove(reactionsRef);
      } else {
        await set(reactionsRef, reactions);
      }

      // Also store in unified interactions path
      const interactionsRef = ref(database, `challenges/${challengeId}/interactions`);
      const newInteractionRef = push(interactionsRef);
      const interactionData = {
        interactionId: newInteractionRef.key || `int_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type: "reaction",
        userId,
        userName,
        userAvatar,
        reaction: normalizedReaction,
        action: "removed",
        timestamp: Date.now(),
      };
      await set(newInteractionRef, interactionData);

      // Emit socket event for removal
      emitChallengeReaction(challengeId, userId, normalizedReaction, {
        action: "removed",
        reactions: reactions,
        userName,
        userAvatar,
      });

      return res.json({
        success: true,
        action: "removed",
        reactions: reactions,
      });
    } else {
      // Add reaction
      reactions[normalizedReaction].push({
        userId,
        userName,
        userAvatar,
        timestamp: Date.now(),
      });

      await set(reactionsRef, reactions);

      // Also store in unified interactions path
      const interactionsRef = ref(database, `challenges/${challengeId}/interactions`);
      const newInteractionRef = push(interactionsRef);
      const interactionData = {
        interactionId: newInteractionRef.key || `int_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type: "reaction",
        userId,
        userName,
        userAvatar,
        reaction: normalizedReaction,
        action: "added",
        timestamp: Date.now(),
      };
      await set(newInteractionRef, interactionData);

      // Emit socket event immediately (optimistic update)
      emitChallengeReaction(challengeId, userId, normalizedReaction, {
        action: "added",
        reactions: reactions,
        userName,
        userAvatar,
      });

      // Create notification for opponent (fire and forget)
      if (opponentId && opponentId !== userId) {
        const notificationData = {
          id: `challenge_reaction_${Date.now()}_${userId}`,
          userId,
          userName,
          userAvatar,
          recipientId: opponentId,
          type: "challenge_reaction",
          title: "New challenge reaction",
          message: `${userName} reacted ${normalizedReaction} to your challenge`,
          challengeId,
          createdAt: Date.now(),
          isRead: false,
        };

        createNotification(opponentId, notificationData).catch((notifyError) => {
          log.warn("addReaction:notification_failed", {
            error: notifyError.message,
            opponentId,
            challengeId,
          });
        });
      }

      return res.json({
        success: true,
        action: "added",
        reactions: reactions,
      });
    }
  } catch (error) {
    log.error("addReaction:error", { error: error.message });
    res.status(500).json({
      error: "Failed to add reaction",
      message: error.message,
    });
  }
};

/**
 * Get reactions for a challenge
 */
const getReactions = async (req, res) => {
  try {
    const { challengeId } = req.params;

    // Try unified interactions first, then fallback to reactions path
    const interactionsRef = ref(database, `challenges/${challengeId}/interactions`);
    const interactionsSnap = await get(interactionsRef);

    if (interactionsSnap.exists()) {
      const interactions = interactionsSnap.val();
      const reactionsMap = {};
      
      // Build reactions map from interactions
      Object.values(interactions).forEach((interaction) => {
        if (interaction.type === "reaction" && interaction.action === "added") {
          const emoji = interaction.reaction;
          if (!reactionsMap[emoji]) {
            reactionsMap[emoji] = [];
          }
          reactionsMap[emoji].push({
            userId: interaction.userId || "",
            userName: interaction.userName || "",
            userAvatar: interaction.userAvatar || "",
            timestamp: interaction.timestamp || Date.now(),
          });
        }
      });

      // Also merge with existing reactions path for backward compatibility
      const reactionsRef = ref(database, `challenges/${challengeId}/reactions`);
      const reactionsSnap = await get(reactionsRef);
      if (reactionsSnap.exists()) {
        const existingReactions = reactionsSnap.val();
        Object.entries(existingReactions).forEach(([emoji, entries]) => {
          if (!reactionsMap[emoji]) {
            reactionsMap[emoji] = [];
          }
          const entryList = Array.isArray(entries) ? entries : Object.values(entries);
          entryList.forEach((entry) => {
            if (entry && typeof entry === "object") {
              const exists = reactionsMap[emoji].some(
                (r) => r.userId === entry.userId && r.timestamp === entry.timestamp
              );
              if (!exists) {
                reactionsMap[emoji].push({
                  userId: entry.userId || "",
                  userName: entry.userName || "",
                  userAvatar: entry.userAvatar || "",
                  timestamp: entry.timestamp || Date.now(),
                });
              }
            }
          });
        });
      }

      return res.json({
        success: true,
        reactions: reactionsMap,
      });
    }

    // Fallback to old reactions path
    const reactionsRef = ref(database, `challenges/${challengeId}/reactions`);
    const reactionsSnap = await get(reactionsRef);

    if (!reactionsSnap.exists()) {
      return res.json({ success: true, reactions: {} });
    }

    return res.json({
      success: true,
      reactions: reactionsSnap.val(),
    });
  } catch (error) {
    log.error("getReactions:error", { error: error.message });
    res.status(500).json({
      error: "Failed to get reactions",
      message: error.message,
    });
  }
};

module.exports = {
  addReaction,
  getReactions,
};

