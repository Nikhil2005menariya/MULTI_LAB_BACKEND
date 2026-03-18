const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const { getProfile, changePassword } = require('../../controllers/student.controller');

/* =====================================================
   STUDENT PROFILE ROUTES
   Base Path: /api/student/profile
===================================================== */

// 🔐 Student-only access
router.use(auth, role('student'));

/* ============================
   GET MY PROFILE
   GET /api/student/profile
============================ */
router.get('/', getProfile);

/* ============================
   CHANGE PASSWORD
   PATCH /api/student/profile/change-password
============================ */
router.patch('/change-password', changePassword);

module.exports = router;