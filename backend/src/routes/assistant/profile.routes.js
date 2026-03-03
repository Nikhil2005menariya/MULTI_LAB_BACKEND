const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  staffChangePassword,
  staffRequestEmailChangeOTP,
  staffConfirmEmailChange,
} = require('../../controllers/auth.controller');

/* =====================================================
   LAB ASSISTANT PROFILE ROUTES
   (Role: assistant)
===================================================== */

// 🔒 Assistant only
router.use(auth, role('assistant'));

router.post('/change-password', staffChangePassword);

// Request email change OTP
router.post('/request-email-change', staffRequestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', staffConfirmEmailChange);

module.exports = router;