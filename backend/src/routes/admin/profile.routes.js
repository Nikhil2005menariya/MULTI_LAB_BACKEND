const express = require('express');
const router = express.Router();

// middlewares
const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

// controllers (new unified auth controller)
const {
  changePassword,
  requestEmailChangeOTP,
  confirmEmailChange,
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
router.post('/change-password', staffChangePassword);

// Request email change OTP
router.post('/request-email-change', staffRequestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', staffConfirmEmailChange);

module.exports = router;