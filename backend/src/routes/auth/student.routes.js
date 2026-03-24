const express = require('express');
const router = express.Router();

const {
  loginLimiter,
  passwordResetLimiter,
  registrationLimiter,
  otpLimiter
} = require('../../middlewares/rateLimiter.middleware');

const {
  registerStudent,
  verifyStudentEmail,
  studentLogin,
  studentForgotPassword,
  studentResetPassword
} = require('../../controllers/auth.controller');

// Registration with rate limit
router.post('/register', registrationLimiter, registerStudent);

// Email verification with OTP limit
router.get('/verify-email', otpLimiter, verifyStudentEmail);

// Login with rate limit
router.post('/login', loginLimiter, studentLogin);

// Password reset flows with rate limits
router.post('/forgot-password', passwordResetLimiter, studentForgotPassword);
router.post('/reset-password', passwordResetLimiter, studentResetPassword);

module.exports = router;
