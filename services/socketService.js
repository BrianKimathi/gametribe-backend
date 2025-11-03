const { Server } = require("socket.io");
const { createLogger } = require("../utils/logger");
const axios = require("axios");
const log = createLogger("socket");

let io = null;

// Optional: external sockets relay (Render)
const SOCKETS_EMIT_URL = process.env.SOCKETS_EMIT_URL || ""; // e.g., https://your-sockets.onrender.com
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
    await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": SOCKETS_INTERNAL_SECRET,
      },
      timeout: 8000,
    });
    return true;
  } catch (err) {
    log.error("Failed to relay emit", { path, error: err.message });
    return false;
  }
}

/**
 * Initialize Socket.IO server
 */
const initializeSocketIO = (httpServer) => {
  // Skip Socket.IO initialization if no HTTP server (Vercel serverless)
  if (!httpServer || process.env.VERCEL) {
    log.warn("Socket.IO skipped: No HTTP server available (Vercel serverless)");
    log.warn(
      "Real-time features will be limited. Consider using polling-only mode on client."
    );
    return null;
  }

  // Configure CORS for Socket.IO
  // Allow ngrok URLs (for local development)
  const defaultOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5000",
    "https://hub.gametribe.com",
    "https://gametribe.com",
    "https://gametibe2025.web.app",
    "https://gametibe2025.firebaseapp.com",
    "https://community-gametribe.web.app",
    "https://community-gametribe.firebaseapp.com",
  ];

  // Add ngrok URLs if present in environment
  const ngrokUrl = process.env.NGROK_URL;
  if (ngrokUrl) {
    defaultOrigins.push(ngrokUrl);
  }

  // Allow any ngrok URL for local development
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").concat(defaultOrigins)
    : defaultOrigins;

  // In development, allow all ngrok URLs
  if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
    allowedOrigins.push(/^https:\/\/.*\.ngrok-free\.app$/);
    allowedOrigins.push(/^https:\/\/.*\.ngrok\.io$/);
  }

  // Prefer polling for better compatibility with various hosting platforms
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // Check if origin matches allowed patterns
        const isAllowed = allowedOrigins.some((allowed) => {
          if (typeof allowed === "string") {
            return origin === allowed;
          }
          if (allowed instanceof RegExp) {
            return allowed.test(origin);
          }
          return false;
        });

        if (isAllowed || process.env.NODE_ENV === "development") {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["polling", "websocket"], // Prefer polling for better compatibility
    // Additional options for better compatibility
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    // Allow all origins in development for ngrok
    allowRequest: (req, callback) => {
      if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
        return callback(null, true);
      }
      callback(null, true);
    },
  });

  // Authentication middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }

    // Verify Firebase JWT token
    const admin = require("firebase-admin");
    admin
      .auth()
      .verifyIdToken(token)
      .then((decodedToken) => {
        socket.userId = decodedToken.uid;
        socket.userData = decodedToken;
        next();
      })
      .catch((error) => {
        log.error("Socket auth failed", { error: error.message });
        next(new Error("Authentication error: Invalid token"));
      });
  });

  // Connection handler
  io.on("connection", (socket) => {
    const userId = socket.userId;
    log.info("Socket connected", { userId, socketId: socket.id });

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Handle joining challenge room
    socket.on("join:challenge", (challengeId) => {
      socket.join(`challenge:${challengeId}`);
      log.info("Joined challenge room", {
        userId,
        challengeId,
        socketId: socket.id,
      });
    });

    // Handle leaving challenge room
    socket.on("leave:challenge", (challengeId) => {
      socket.leave(`challenge:${challengeId}`);
      log.info("Left challenge room", {
        userId,
        challengeId,
        socketId: socket.id,
      });
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      log.info("Socket disconnected", { userId, socketId: socket.id });
    });

    // Handle errors
    socket.on("error", (error) => {
      log.error("Socket error", { userId, error: error.message });
    });
  });

  log.info("Socket.IO initialized successfully");
  return io;
};

/**
 * Emit challenge created event to opponent
 */
const emitChallengeCreated = (challengerId, challengedId, challengeData) => {
  if (!io) {
    log.debug(
      "Socket.IO not available, attempting relay: emitChallengeCreated"
    );
    relayEmit("/emit/challenge-created", {
      challengerId,
      challengedId,
      data: {
        ...challengeData,
        type: "challenge_created",
      },
    });
    return;
  }

  // Emit to challenged user (the one receiving the challenge)
  io.to(`user:${challengedId}`).emit("challenge:created", {
    ...challengeData,
    type: "challenge_created",
  });

  // Also emit to challenger so they see it in their list immediately
  io.to(`user:${challengerId}`).emit("challenge:created", {
    ...challengeData,
    type: "challenge_created",
  });

  log.info("Challenge created event emitted", {
    challengerId,
    challengedId,
    challengeId: challengeData.challengeId,
  });
  // Also relay to external sockets (Render)
  relayEmit("/emit/challenge-created", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_created" },
  });
};

/**
 * Emit challenge accepted event to challenger
 */
const emitChallengeAccepted = (challengerId, challengedId, challengeData) => {
  if (!io) {
    log.debug(
      "Socket.IO not available, attempting relay: emitChallengeAccepted"
    );
    relayEmit("/emit/challenge-accepted", {
      challengerId,
      challengedId,
      data: {
        ...challengeData,
        type: "challenge_accepted",
      },
    });
    return;
  }

  io.to(`user:${challengerId}`).emit("challenge:accepted", {
    ...challengeData,
    type: "challenge_accepted",
  });

  log.info("Challenge accepted event emitted", {
    challengerId,
    challengeId: challengeData.challengeId,
  });
  // Also relay
  relayEmit("/emit/challenge-accepted", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_accepted" },
  });
};

/**
 * Emit challenge rejected event to challenger
 */
const emitChallengeRejected = (challengerId, challengedId, challengeData) => {
  if (!io) {
    log.debug(
      "Socket.IO not available, attempting relay: emitChallengeRejected"
    );
    relayEmit("/emit/challenge-rejected", {
      challengerId,
      challengedId,
      data: {
        ...challengeData,
        type: "challenge_rejected",
      },
    });
    return;
  }

  io.to(`user:${challengerId}`).emit("challenge:rejected", {
    ...challengeData,
    type: "challenge_rejected",
  });

  log.info("Challenge rejected event emitted", {
    challengerId,
    challengeId: challengeData.challengeId,
  });
  // Also relay
  relayEmit("/emit/challenge-rejected", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_rejected" },
  });
};

/**
 * Emit challenge cancelled event to opponent
 */
const emitChallengeCancelled = (challengerId, challengedId, challengeData) => {
  if (!io) {
    log.debug("Socket.IO not available, skipping emitChallengeCancelled");
    return;
  }

  const opponentId =
    challengerId === challengedId
      ? challengeData.challengedId
      : challengeData.challengerId;

  io.to(`user:${opponentId}`).emit("challenge:cancelled", {
    ...challengeData,
    type: "challenge_cancelled",
  });

  log.info("Challenge cancelled event emitted", {
    opponentId,
    challengeId: challengeData.challengeId,
  });
};

/**
 * Emit score updated event to opponent
 */
const emitScoreUpdated = (userId, opponentId, challengeId, scoreData) => {
  if (!io) {
    log.debug("Socket.IO not available, attempting relay: emitScoreUpdated");
    relayEmit("/emit/score-updated", {
      userId,
      opponentId,
      challengeId,
      data: {
        ...scoreData,
        type: "score_updated",
      },
    });
    return;
  }

  // Emit to opponent (the one who didn't submit the score)
  io.to(`user:${opponentId}`).emit("challenge:score_updated", {
    challengeId,
    userId,
    ...scoreData,
    type: "score_updated",
  });

  // Also emit to the user who submitted (for immediate UI update)
  io.to(`user:${userId}`).emit("challenge:score_updated", {
    challengeId,
    userId,
    ...scoreData,
    type: "score_updated",
  });

  // Also emit to challenge room in case both users are watching
  io.to(`challenge:${challengeId}`).emit("challenge:score_updated", {
    challengeId,
    userId,
    ...scoreData,
    type: "score_updated",
  });

  log.info("Score updated event emitted", {
    userId,
    opponentId,
    challengeId,
  });
  // Also relay
  relayEmit("/emit/score-updated", {
    userId,
    opponentId,
    challengeId,
    data: { ...scoreData, type: "score_updated" },
  });
};

/**
 * Emit game started event
 */
const emitGameStarted = (userId, opponentId, challengeId) => {
  if (!io) {
    log.debug("Socket.IO not available, skipping emitGameStarted");
    return;
  }

  io.to(`user:${opponentId}`).emit("challenge:game_started", {
    challengeId,
    userId,
    type: "game_started",
  });

  io.to(`challenge:${challengeId}`).emit("challenge:game_started", {
    challengeId,
    userId,
    type: "game_started",
  });

  log.info("Game started event emitted", {
    userId,
    opponentId,
    challengeId,
  });
};

/**
 * Emit challenge completed event (both players finished)
 */
const emitChallengeCompleted = (challengerId, challengedId, challengeData) => {
  if (!io) {
    log.debug(
      "Socket.IO not available, attempting relay: emitChallengeCompleted"
    );
    relayEmit("/emit/challenge-completed", {
      challengerId,
      challengedId,
      data: {
        ...challengeData,
        type: "challenge_completed",
      },
    });
    return;
  }

  // Emit to both players
  io.to(`user:${challengerId}`).emit("challenge:completed", {
    ...challengeData,
    type: "challenge_completed",
  });

  io.to(`user:${challengedId}`).emit("challenge:completed", {
    ...challengeData,
    type: "challenge_completed",
  });

  // Emit to challenge room
  io.to(`challenge:${challengeData.challengeId}`).emit("challenge:completed", {
    ...challengeData,
    type: "challenge_completed",
  });

  log.info("Challenge completed event emitted", {
    challengerId,
    challengedId,
    challengeId: challengeData.challengeId,
  });
  // Also relay
  relayEmit("/emit/challenge-completed", {
    challengerId,
    challengedId,
    data: { ...challengeData, type: "challenge_completed" },
  });
};

/**
 * Get Socket.IO instance
 */
const getIO = () => {
  return io;
};

module.exports = {
  initializeSocketIO,
  emitChallengeCreated,
  emitChallengeAccepted,
  emitChallengeRejected,
  emitChallengeCancelled,
  emitScoreUpdated,
  emitGameStarted,
  emitChallengeCompleted,
  getIO,
};
