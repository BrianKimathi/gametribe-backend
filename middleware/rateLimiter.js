const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

/**
 * Rate Limiting Middleware
 * Handles API rate limiting with in-memory store
 */

/**
 * Development-friendly rate limiter (very lenient)
 */
const devLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Very high limit for development (increased from 5000)
  message: {
    error: "Too many requests",
    message: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, _res) => ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({
      error: "Rate limit exceeded",
      message: "Too many requests from this IP, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * General API rate limiter
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // Limit each IP to 5000 requests per windowMs (increased for development)
  message: {
    error: "Too many requests",
    message: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req, _res) => ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({
      error: "Rate limit exceeded",
      message: "Too many requests from this IP, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * Strict rate limiter for sensitive endpoints
 */
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: "Rate limit exceeded",
    message:
      "Too many requests to this sensitive endpoint, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Rate limit exceeded",
      message:
        "Too many requests to this sensitive endpoint, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * Authentication rate limiter
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    error: "Too many authentication attempts",
    message: "Too many login attempts from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  keyGenerator: (req, _res) => ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({
      error: "Authentication rate limit exceeded",
      message: "Too many login attempts from this IP, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * Payment rate limiter
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200, // Limit each IP to 200 payment attempts per hour (increased for development)
  message: {
    error: "Payment rate limit exceeded",
    message: "Too many payment attempts from this IP, please try again later.",
    retryAfter: "1 hour",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Payment rate limit exceeded",
      message:
        "Too many payment attempts from this IP, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * File upload rate limiter
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Limit each IP to 50 uploads per hour
  message: {
    error: "Upload rate limit exceeded",
    message: "Too many file uploads from this IP, please try again later.",
    retryAfter: "1 hour",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Upload rate limit exceeded",
      message: "Too many file uploads from this IP, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * Search rate limiter
 */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 searches per minute (increased from 30)
  message: {
    error: "Search rate limit exceeded",
    message: "Too many search requests from this IP, please try again later.",
    retryAfter: "1 minute",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, _res) => ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({
      error: "Search rate limit exceeded",
      message: "Too many search requests from this IP, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * Webhook rate limiter
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 webhook calls per minute
  message: {
    error: "Webhook rate limit exceeded",
    message: "Too many webhook calls from this IP, please try again later.",
    retryAfter: "1 minute",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Webhook rate limit exceeded",
      message: "Too many webhook calls from this IP, please try again later.",
      retryAfter: Math.round(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * No rate limiting (for development)
 */
const noLimiter = (req, res, next) => {
  // Skip rate limiting entirely
  next();
};

/**
 * Custom rate limiter factory
 */
const createCustomLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: "Rate limit exceeded",
        message:
          message || "Too many requests from this IP, please try again later.",
        retryAfter: Math.round(req.rateLimit.resetTime / 1000),
      });
    },
  });
};

module.exports = {
  noLimiter,
  devLimiter,
  generalLimiter,
  strictLimiter,
  authLimiter,
  paymentLimiter,
  uploadLimiter,
  searchLimiter,
  webhookLimiter,
  createCustomLimiter,
};
