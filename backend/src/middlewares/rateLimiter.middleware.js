const rateLimit = require('express-rate-limit');

/* =====================================================
   SECURITY: Rate Limiting Configuration
   Prevents brute force and DoS attacks
===================================================== */

// Create rate limiter with custom options
const createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes default
    max: options.max || 100, // 100 requests per window default
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    // Custom keyGenerator to handle proxy headers correctly
    keyGenerator: (req, res) => {
      return req.ip || req.socket.remoteAddress;
    },
    handler: (req, res) => {
      res.status(429).json({
        error: options.message || 'Too many requests, please try again later'
      });
    }
  });
};

/* =====================================================
   PRE-CONFIGURED RATE LIMITERS
===================================================== */

// Login endpoint - strict limit
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 attempts for testing
  message: 'Too many login attempts, please try again after 15 minutes'
});

// Password reset - strict limit
const passwordResetLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 attempts
  message: 'Too many password reset attempts, please try again later'
});

// Registration - moderate limit
const registrationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: 'Too many registration attempts, please try again later'
});

// OTP verification - strict limit
const otpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many verification attempts, please try again later'
});

// Email change requests - moderate limit
const emailChangeLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: 'Too many email change requests, please try again later'
});

// API general - higher limit for authenticated routes
const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes for testing
  message: 'Too many requests, please slow down'
});

// File upload - strict limit
const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: 'Too many file uploads, please try again later'
});

// Search endpoints - moderate limit
const searchLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 searches per minute for testing
  message: 'Too many search requests, please slow down'
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  passwordResetLimiter,
  registrationLimiter,
  otpLimiter,
  emailChangeLimiter,
  apiLimiter,
  uploadLimiter,
  searchLimiter
};
