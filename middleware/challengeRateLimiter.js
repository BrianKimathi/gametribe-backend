/**
 * Challenge-specific rate limiter
 * Enforces rate limits for challenge operations
 */

// In-memory rate limiting (for production, use Redis)
const rateLimitStore = new Map();

/**
 * Enforce rate limit for challenge operations
 */
const enforceChallengeRateLimit = (req, res, next) => {
  try {
    // Global bypass for development or when explicitly disabled
    if (
      process.env.DISABLE_RATE_LIMITING === "true" ||
      process.env.NODE_ENV !== "production"
    ) {
      return next();
    }
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const operation = req.path.includes("/create")
      ? "create"
      : req.path.includes("/accept")
      ? "accept"
      : req.path.includes("/reject")
      ? "reject"
      : req.path.includes("/score")
      ? "score"
      : "general";

    const key = `challenge_${operation}_${userId}`;
    const now = Date.now();

    // Rate limit configurations
    const limits = {
      create: { maxRequests: 5, windowMs: 5 * 60 * 1000 }, // 5 per 5 minutes
      accept: { maxRequests: 10, windowMs: 5 * 60 * 1000 }, // 10 per 5 minutes
      reject: { maxRequests: 10, windowMs: 5 * 60 * 1000 }, // 10 per 5 minutes
      score: { maxRequests: 20, windowMs: 5 * 60 * 1000 }, // 20 per 5 minutes
      general: { maxRequests: 50, windowMs: 5 * 60 * 1000 }, // 50 per 5 minutes
    };

    const limit = limits[operation];

    // Get or create request log
    let requestLog = rateLimitStore.get(key);
    if (!requestLog) {
      requestLog = { requests: [], firstRequest: now };
      rateLimitStore.set(key, requestLog);
    }

    // Clean old requests outside window
    requestLog.requests = requestLog.requests.filter(
      (timestamp) => now - timestamp < limit.windowMs
    );

    // Check if limit exceeded
    if (requestLog.requests.length >= limit.maxRequests) {
      const oldestRequest = requestLog.requests[0];
      const retryAfter = Math.ceil(
        (oldestRequest + limit.windowMs - now) / 1000
      );

      return res.status(429).json({
        error: "Rate limit exceeded",
        message: `Too many ${operation} requests. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      });
    }

    // Add current request
    requestLog.requests.push(now);
    rateLimitStore.set(key, requestLog);

    // Cleanup old entries periodically (every 100 requests)
    if (Math.random() < 0.01) {
      cleanupOldEntries();
    }

    next();
  } catch (error) {
    console.error("Rate limit enforcement error:", error);
    // Don't block on rate limiter errors
    next();
  }
};

/**
 * Cleanup old rate limit entries
 */
const cleanupOldEntries = () => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour

  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.firstRequest > maxAge) {
      rateLimitStore.delete(key);
    }
  }

  console.log(
    `🧹 Cleaned up rate limit store. Current size: ${rateLimitStore.size}`
  );
};

/**
 * Get rate limit stats (for monitoring)
 */
const getRateLimitStats = () => {
  return {
    totalKeys: rateLimitStore.size,
    entries: Array.from(rateLimitStore.entries()).map(([key, data]) => ({
      key,
      requests: data.requests.length,
      firstRequest: data.firstRequest,
    })),
  };
};

module.exports = {
  enforceChallengeRateLimit,
  getRateLimitStats,
  cleanupOldEntries,
};
