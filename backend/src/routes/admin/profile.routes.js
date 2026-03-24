const express = require('express');
const router = express.Router();

// middlewares
const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const { otpLimiter, emailChangeLimiter } = require('../../middlewares/rateLimiter.middleware');

// controllers (unified auth controller)
const {
  staffConfirmEmailChange,
  staffRequestEmailChangeOTP,
  staffChangePassword
} = require('../../controllers/auth.controller');

/* =====================================================
   LAB INCHARGE PROFILE ROUTES
   (Only role: incharge)
===================================================== */

router.use(auth, role('incharge'));

// Change password
router.post('/change-password', otpLimiter, staffChangePassword);

// Request email change OTP
router.post('/request-email-change', emailChangeLimiter, staffRequestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', otpLimiter, staffConfirmEmailChange);

module.exports = router;
