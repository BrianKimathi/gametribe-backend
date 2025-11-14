const { createLogger } = require("../utils/logger");
const axios = require("axios");
const { database } = require("../config/firebase");
const { ref, get } = require("firebase/database");

const log = createLogger("socket-relay");

const SOCKETS_EMIT_URL =
  process.env.SOCKETS_EMIT_URL || "https://sockets-render.onrender.com";
const SOCKETS_INTERNAL_SECRET = process.env.SOCKETS_INTERNAL_SECRET || "";

async function relayEmit(path, payload) {
  if (!SOCKETS_EMIT_URL || !SOCKETS_INTERNAL_SECRET) {
    log.warn("Sockets relay not configured", {
      hasEmitUrl: Boolean(SOCKETS_EMIT_URL),
      hasSecret: Boolean(SOCKETS_INTERNAL_SECRET),
      path,
    });
    return false;
  }

  try {
    const url = `${SOCKETS_EMIT_URL.replace(/\/$/, "")}${path}`;
    log.info("relay:emitting", {
      path,
      url,
      payloadKeys: Object.keys(payload),
      challengeId: payload.challengeId || payload.data?.challengeId,
    });
    const started = Date.now();
    await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": SOCKETS_INTERNAL_SECRET,
      },
      timeout: 8000,
    });
    log.info("relay:success", {
      path,
      durationMs: Date.now() - started,
    });
    return true;
  } catch (err) {
    log.error("relay:failed", {
      path,
      error: err.message,
      status: err.response?.status,
      statusText: err.response?.statusText,
    });
    return false;
  }
}

const emitChallengeCreated = (challengerId, challengedId, challengeData) => {
  relayEmit("/emit/challenge-created", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_created" },
  });
};

const emitChallengeAccepted = (challengerId, challengedId, challengeData) => {
  relayEmit("/emit/challenge-accepted", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_accepted" },
  });
};

const emitChallengeRejected = (challengerId, challengedId, challengeData) => {
  relayEmit("/emit/challenge-rejected", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_rejected" },
  });
};

const emitChallengeCancelled = (challengerId, challengedId, challengeData) => {
  relayEmit("/emit/challenge-cancelled", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_cancelled" },
  });
};

const emitScoreUpdated = (userId, opponentId, challengeId, scoreData) => {
  relayEmit("/emit/score-updated", {
    userId,
    opponentId,
    challengeId,
    data: { ...scoreData, type: "score_updated" },
  });
};

const emitGameStarted = (userId, opponentId, challengeId) => {
  relayEmit("/emit/challenge-game-started", {
    userId,
    opponentId,
    challengeId,
    data: { challengeId, userId, type: "game_started" },
  });
};

const emitChallengeCompleted = (challengerId, challengedId, challengeData) => {
  relayEmit("/emit/challenge-completed", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_completed" },
  });
};

const emitChallengeReaction = (challengeId, userId, reaction, reactionData) => {
  // Use opponentId from reactionData if available (optimized path)
  const opponentId = reactionData.opponentId;

  if (opponentId) {
    // Fast path: opponentId already provided
    relayEmit("/emit/challenge-reaction", {
      challengeId,
      userId,
      opponentId,
      reaction,
      data: { ...reactionData, type: "challenge_reaction" },
    });
    return;
  }

  // Fallback: fetch challenge to get opponentId (should rarely happen)
  const challengeRef = ref(database, `challenges/${challengeId}`);
  get(challengeRef)
    .then((snap) => {
      if (!snap.exists()) {
        log.warn("Challenge not found for reaction emit", { challengeId });
        return relayEmit("/emit/challenge-reaction", {
          challengeId,
          userId,
          reaction,
          data: { ...reactionData, type: "challenge_reaction" },
        });
      }

      const challenge = snap.val();
      const fetchedOpponentId =
        challenge.challengerId === userId
          ? challenge.challengedId
          : challenge.challengerId;

      relayEmit("/emit/challenge-reaction", {
        challengeId,
        userId,
        opponentId: fetchedOpponentId,
        reaction,
        data: { ...reactionData, type: "challenge_reaction" },
      });
    })
    .catch((error) => {
      log.error("Error emitting challenge reaction", { error: error.message });
      relayEmit("/emit/challenge-reaction", {
        challengeId,
        userId,
        reaction,
        data: { ...reactionData, type: "challenge_reaction" },
      });
    });
};

const emitChallengeMessage = (challengeId, userId, message, messageData) => {
  // Use opponentId from messageData if available (optimized path)
  const opponentId = messageData.opponentId;

  if (opponentId) {
    // Fast path: opponentId already provided
    relayEmit("/emit/challenge-message", {
      challengeId,
      userId,
      opponentId,
      message,
      data: { ...messageData, type: "challenge_message" },
    });
    return;
  }

  // Fallback: fetch challenge to get opponentId (should rarely happen)
  const challengeRef = ref(database, `challenges/${challengeId}`);
  get(challengeRef)
    .then((snap) => {
      if (!snap.exists()) {
        log.warn("Challenge not found for message emit", { challengeId });
        return relayEmit("/emit/challenge-message", {
          challengeId,
          userId,
          message,
          data: { ...messageData, type: "challenge_message" },
        });
      }

      const challenge = snap.val();
      const fetchedOpponentId =
        challenge.challengerId === userId
          ? challenge.challengedId
          : challenge.challengerId;

      relayEmit("/emit/challenge-message", {
        challengeId,
        userId,
        opponentId: fetchedOpponentId,
        message,
        data: { ...messageData, type: "challenge_message" },
      });
    })
    .catch((error) => {
      log.error("Error emitting challenge message", { error: error.message });
      relayEmit("/emit/challenge-message", {
        challengeId,
        userId,
        message,
        data: { ...messageData, type: "challenge_message" },
      });
    });
};

// Chat event emitters
const emitChatTyping = (chatId, chatType, userId, userName, isTyping) => {
  relayEmit("/emit/chat-typing", {
    chatId,
    chatType,
    userId,
    userName,
    isTyping,
  });
};

const emitChatGamePlaying = (
  chatId,
  chatType,
  userId,
  userName,
  gameTitle,
  gameId,
  isPlaying
) => {
  relayEmit("/emit/chat-game-playing", {
    chatId,
    chatType,
    userId,
    userName,
    gameTitle,
    gameId,
    isPlaying,
  });
};

const emitChatGameScore = (
  chatId,
  chatType,
  userId,
  userName,
  gameTitle,
  score
) => {
  relayEmit("/emit/chat-game-score", {
    chatId,
    chatType,
    userId,
    userName,
    gameTitle,
    score,
  });
};

const emitMessageRead = (chatId, chatType, messageId, userId) => {
  relayEmit("/emit/chat-message-read", {
    chatId,
    chatType,
    messageId,
    userId,
  });
};

const emitMessageDelivered = (chatId, chatType, messageId, userId) => {
  relayEmit("/emit/chat-message-delivered", {
    chatId,
    chatType,
    messageId,
    userId,
  });
};

module.exports = {
  emitChallengeCreated,
  emitChallengeAccepted,
  emitChallengeRejected,
  emitChallengeCancelled,
  emitScoreUpdated,
  emitGameStarted,
  emitChallengeCompleted,
  emitChallengeReaction,
  emitChallengeMessage,
  emitChatTyping,
  emitChatGamePlaying,
  emitChatGameScore,
  emitMessageRead,
  emitMessageDelivered,
};
