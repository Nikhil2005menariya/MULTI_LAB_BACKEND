const express = require('express');
const router = express.Router();

// middlewares
const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

// controllers (new unified auth controller)
const {
  changePassword,
  requestEmailChangeOTP,
  confirmEmailChange
} = require('../../controllers/auth.controller');

/* =====================================================
   LAB INCHARGE PROFILE ROUTES
   (Only role: incharge)
===================================================== */

router.use(auth, role('incharge'));

// Change password
router.post('/change-password', changePassword);

// Request email change OTP
router.post('/request-email-change', requestEmailChangeOTP);

// Confirm email change
router.post('/confirm-email-change', confirmEmailChange);

module.exports = router;