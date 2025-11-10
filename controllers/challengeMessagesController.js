const { database } = require("../config/firebase");
const { ref, get, push, query, orderByChild, limitToLast, set } = require("firebase/database");
const { createLogger } = require("../utils/logger");
const { emitChallengeMessage } = require("../services/socketService");
const { createNotification } = require("./notificationController");
const log = createLogger("challenge-messages");

/**
 * Send a message in a challenge room
 */
const sendMessage = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { message } = req.body;
    const userId = req.user.uid;
    const userName = req.user.name || req.user.displayName || "User";
    const userAvatar = req.user.picture || req.user.photoURL || "";

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    if (!challengeId) {
      return res.status(400).json({ error: "Missing challengeId" });
    }

    // Get challenge data
    const challengeRef = ref(database, `challenges/${challengeId}`);
    const challengeSnap = await get(challengeRef);

    if (!challengeSnap.exists()) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challengeData = challengeSnap.val();

    const allowedStatuses = ["accepted", "completed"];
    if (!allowedStatuses.includes((challengeData.status || "").toLowerCase())) {
      return res
        .status(400)
        .json({ error: "Chat is available once a challenge is accepted" });
    }

    // Verify user is part of this challenge
    if (
      challengeData.challengerId !== userId &&
      challengeData.challengedId !== userId
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Store in unified interactions path with type label
    const interactionsRef = ref(database, `challenges/${challengeId}/interactions`);
    const newInteractionRef = push(interactionsRef);
    const interactionId = newInteractionRef.key;

    const interactionData = {
      interactionId: interactionId || `int_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: "message",
      userId,
      userName,
      userAvatar,
      message: message.trim(),
      timestamp: Date.now(),
    };

    await set(newInteractionRef, interactionData);

    // Also maintain backward compatibility with messages path
    const messagesRef = ref(database, `challenges/${challengeId}/messages`);
    const newMessageRef = push(messagesRef);
    const messageId = newMessageRef.key;
    const messageData = {
      messageId: messageId || interactionData.interactionId,
      userId,
      userName,
      userAvatar,
      message: message.trim(),
      timestamp: Date.now(),
    };
    await set(newMessageRef, messageData);

    // Emit socket event immediately (optimistic update)
    emitChallengeMessage(challengeId, userId, message.trim(), {
      ...interactionData,
      messageId: interactionData.interactionId,
    });

    const opponentId =
      challengeData.challengerId === userId
        ? challengeData.challengedId
        : challengeData.challengerId;

    if (opponentId && opponentId !== userId) {
      const notificationData = {
        id: `challenge_message_${Date.now()}_${userId}`,
        userId,
        userName,
        userAvatar,
        recipientId: opponentId,
        type: "challenge_message",
        title: `${userName} sent a challenge message`,
        message: message.trim(),
        messagePreview: message.trim(),
        challengeId,
        createdAt: Date.now(),
        isRead: false,
      };

      createNotification(opponentId, notificationData).catch((notifyError) => {
        log.warn("sendMessage:notification_failed", {
          error: notifyError.message,
          opponentId,
          challengeId,
        });
      });
    }

    log.info("Message sent", {
      challengeId,
      userId,
      messageId,
    });

    return res.json({
      success: true,
      message: interactionData,
      messageId: interactionData.interactionId,
    });
  } catch (error) {
    log.error("sendMessage:error", { error: error.message });
    res.status(500).json({
      error: "Failed to send message",
      message: error.message,
    });
  }
};

/**
 * Get messages for a challenge (from unified interactions)
 */
const getMessages = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    // Try unified interactions first
    const interactionsRef = ref(database, `challenges/${challengeId}/interactions`);
    const interactionsQuery = query(
      interactionsRef,
      orderByChild("timestamp"),
      limitToLast(limit * 2) // Get more to filter messages
    );
    const interactionsSnap = await get(interactionsQuery);

    if (interactionsSnap.exists()) {
      const interactions = interactionsSnap.val();
      const messagesArray = Object.keys(interactions)
        .map((key) => ({
          interactionId: key,
          ...interactions[key],
        }))
        .filter((item) => item.type === "message")
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        .slice(-limit);

      return res.json({
        success: true,
        messages: messagesArray,
      });
    }

    // Fallback to old messages path for backward compatibility
    const messagesRef = ref(database, `challenges/${challengeId}/messages`);
    const messagesQuery = query(
      messagesRef,
      orderByChild("timestamp"),
      limitToLast(limit)
    );
    const messagesSnap = await get(messagesQuery);

    if (!messagesSnap.exists()) {
      return res.json({ success: true, messages: [] });
    }

    const messages = messagesSnap.val();
    const messagesArray = Object.keys(messages)
      .map((key) => ({
        messageId: key,
        type: "message",
        ...messages[key],
      }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return res.json({
      success: true,
      messages: messagesArray,
    });
  } catch (error) {
    log.error("getMessages:error", { error: error.message });
    res.status(500).json({
      error: "Failed to get messages",
      message: error.message,
    });
  }
};

module.exports = {
  sendMessage,
  getMessages,
};

