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
  confirmEmailChange,
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
router.post('/login', staffLogin);

// Forgot password (send OTP)
router.post('/forgot-password', staffForgotPassword);

// Reset password using OTP
router.post('/reset-password',staffResetPassword);


/* =====================================================
   PROTECTED ROUTES (LOGGED IN STAFF)
===================================================== */

// Change password (while logged in)
router.post('/change-password', auth, staffChangePassword);

// Request email change OTP
router.post('/request-email-change', auth, staffRequestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', auth, staffConfirmEmailChange);


module.exports = router;