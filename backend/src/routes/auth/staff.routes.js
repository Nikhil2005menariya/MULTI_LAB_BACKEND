const express = require('express');
const router = express.Router();

// middlewares
const auth = require('../../middlewares/auth.middleware');
const {
  loginLimiter,
  passwordResetLimiter,
  otpLimiter,
  emailChangeLimiter
} = require('../../middlewares/rateLimiter.middleware');

// controllers
const {
  staffLogin,
  staffForgotPassword,
  staffResetPassword,
  staffChangePassword,
  staffRequestEmailChangeOTP,
  staffConfirmEmailChange
} = require('../../controllers/auth.controller');

/* =====================================================
   PUBLIC AUTH ROUTES
===================================================== */

// Login (super_admin / incharge / assistant)
router.post('/login', loginLimiter, staffLogin);

// Forgot password (send OTP)
router.post('/forgot-password', passwordResetLimiter, staffForgotPassword);

// Reset password using OTP
router.post('/reset-password', passwordResetLimiter, staffResetPassword);


/* =====================================================
   PROTECTED ROUTES (LOGGED IN STAFF)
===================================================== */

// Change password (while logged in)
router.post('/change-password', auth, otpLimiter, staffChangePassword);

// Request email change OTP
router.post('/request-email-change', auth, emailChangeLimiter, staffRequestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', auth, otpLimiter, staffConfirmEmailChange);


module.exports = router;
