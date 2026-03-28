const express = require('express');
const router = express.Router();

const {
  loginLimiter,
  passwordResetLimiter,
  registrationLimiter,
  otpLimiter
} = require('../../middlewares/rateLimiter.middleware');

const facultyAuthController = require('../../controllers/auth.controller');

/* ============================
   FACULTY AUTH ROUTES
============================ */

// Register (send verification email)
router.post('/register', registrationLimiter, facultyAuthController.registerFaculty);

// Verify email
router.get('/verify', otpLimiter, facultyAuthController.verifyEmail);

// Resend verification email
router.post('/resend-verification-email', registrationLimiter, facultyAuthController.resendFacultyVerificationEmail);

// Set password (after verification)
router.post('/set-password', otpLimiter, facultyAuthController.setPassword);

// Login
router.post('/login', loginLimiter, facultyAuthController.loginFaculty);

// Password reset flows
router.post('/forgot-password', passwordResetLimiter, facultyAuthController.facultyForgotPassword);
router.post('/reset-password', passwordResetLimiter, facultyAuthController.facultyResetPassword);

module.exports = router;
