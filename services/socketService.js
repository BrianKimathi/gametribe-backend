const { Server } = require("socket.io");
const { createLogger } = require("../utils/logger");
const log = createLogger("socket");

let io = null;

/**
 * Initialize Socket.IO server
 */
const initializeSocketIO = (httpServer) => {
  // Configure CORS for Socket.IO
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5000",
        "https://hub.gametribe.com",
        "https://gametribe.com",
      ];

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
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
      log.info("Joined challenge room", { userId, challengeId, socketId: socket.id });
    });

    // Handle leaving challenge room
    socket.on("leave:challenge", (challengeId) => {
      socket.leave(`challenge:${challengeId}`);
      log.info("Left challenge room", { userId, challengeId, socketId: socket.id });
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
  if (!io) return;
  
  io.to(`user:${challengedId}`).emit("challenge:created", {
    ...challengeData,
    type: "challenge_created",
  });
  
  log.info("Challenge created event emitted", {
    challengedId,
    challengeId: challengeData.challengeId,
  });
};

/**
 * Emit challenge accepted event to challenger
 */
const emitChallengeAccepted = (challengerId, challengedId, challengeData) => {
  if (!io) return;
  
  io.to(`user:${challengerId}`).emit("challenge:accepted", {
    ...challengeData,
    type: "challenge_accepted",
  });
  
  log.info("Challenge accepted event emitted", {
    challengerId,
    challengeId: challengeData.challengeId,
  });
};

/**
 * Emit challenge rejected event to challenger
 */
const emitChallengeRejected = (challengerId, challengedId, challengeData) => {
  if (!io) return;
  
  io.to(`user:${challengerId}`).emit("challenge:rejected", {
    ...challengeData,
    type: "challenge_rejected",
  });
  
  log.info("Challenge rejected event emitted", {
    challengerId,
    challengeId: challengeData.challengeId,
  });
};

/**
 * Emit challenge cancelled event to opponent
 */
const emitChallengeCancelled = (challengerId, challengedId, challengeData) => {
  if (!io) return;
  
  const opponentId = challengerId === challengedId ? challengeData.challengedId : challengeData.challengerId;
  
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
  if (!io) return;
  
  // Emit to opponent
  io.to(`user:${opponentId}`).emit("challenge:score_updated", {
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
};

/**
 * Emit game started event
 */
const emitGameStarted = (userId, opponentId, challengeId) => {
  if (!io) return;
  
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
  if (!io) return;
  
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

