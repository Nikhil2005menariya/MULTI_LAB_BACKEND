const express = require('express');
const router = express.Router();

// middlewares
const auth = require('../../middlewares/auth.middleware');

// controllers
const {
  staffLogin,
  forgotPassword,
  resetPassword,
  changePassword,
  requestEmailChangeOTP,
  confirmEmailChange
} = require('../../controllers/auth.controller');

/* =====================================================
   PUBLIC AUTH ROUTES
===================================================== */

// Login (super_admin / incharge / assistant)
router.post('/login', staffLogin);

// Forgot password (send OTP)
router.post('/forgot-password', forgotPassword);

// Reset password using OTP
router.post('/reset-password', resetPassword);


/* =====================================================
   PROTECTED ROUTES (LOGGED IN STAFF)
===================================================== */

// Change password (while logged in)
router.post('/change-password', auth, changePassword);

// Request email change OTP
router.post('/request-email-change', auth, requestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', auth, confirmEmailChange);


module.exports = router;