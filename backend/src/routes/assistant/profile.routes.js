const express = require('express');
const router = express.Router();

const {
  otpLimiter,
  emailChangeLimiter
} = require('../../middlewares/rateLimiter.middleware');

const {
  staffChangePassword,
  staffRequestEmailChangeOTP,
  staffConfirmEmailChange,
} = require('../../controllers/auth.controller');

/* =====================================================
   LAB ASSISTANT PROFILE ROUTES
   (Role: assistant)
   Auth applied at index.js level
===================================================== */

// Change password with OTP rate limiting
router.post('/change-password', otpLimiter, staffChangePassword);

// Request email change OTP with rate limiting
router.post('/request-email-change', emailChangeLimiter, staffRequestEmailChangeOTP);

// Confirm email change with OTP rate limiting
router.post('/confirm-email-change', otpLimiter, staffConfirmEmailChange);

module.exports = router;
