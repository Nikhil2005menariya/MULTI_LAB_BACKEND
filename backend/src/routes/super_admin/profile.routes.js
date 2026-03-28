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

// Get super admin profile
const { getSuperAdminProfile } = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN PROFILE ROUTES
   (Role: super_admin)
===================================================== */

// Get profile
router.get('/', getSuperAdminProfile);

// Change password with OTP rate limiting
router.post('/change-password', otpLimiter, staffChangePassword);

// Request email change OTP with rate limiting
router.post('/request-email-change', emailChangeLimiter, staffRequestEmailChangeOTP);

// Confirm email change with OTP rate limiting
router.post('/confirm-email-change', otpLimiter, staffConfirmEmailChange);

module.exports = router;
