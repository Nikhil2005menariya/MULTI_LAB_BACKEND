const express = require('express');
const router = express.Router();

const { otpLimiter } = require('../../middlewares/rateLimiter.middleware');

const { getProfile, changePassword } = require('../../controllers/student.controller');

/* =====================================================
   STUDENT PROFILE ROUTES
   Base Path: /api/student/profile
   Auth applied at index.js level
===================================================== */

/* ============================
   GET MY PROFILE
   GET /api/student/profile
============================ */
router.get('/', getProfile);

/* ============================
   CHANGE PASSWORD
   PATCH /api/student/profile/change-password
============================ */
router.patch('/change-password', otpLimiter, changePassword);

module.exports = router;
