const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  changePassword,
  requestEmailChangeOTP,
  confirmEmailChange
} = require('../../controllers/auth.controller');

/* =====================================================
   LAB ASSISTANT PROFILE ROUTES
   (Role: assistant)
===================================================== */

// 🔒 Assistant only
router.use(auth, role('assistant'));

// Change password
router.post('/change-password', changePassword);

// Request email change OTP
router.post('/request-email-change', requestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', confirmEmailChange);

module.exports = router;