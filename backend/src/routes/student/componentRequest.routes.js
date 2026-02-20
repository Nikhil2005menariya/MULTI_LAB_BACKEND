const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  requestComponent,
  getMyComponentRequests
} = require('../../controllers/student.controller');

/* =====================================================
   STUDENT COMPONENT REQUEST ROUTES
   Base Path: /api/student/component-requests
===================================================== */

// 🔐 Student-only access
router.use(auth, role('student'));

/* ============================
   CREATE COMPONENT REQUEST
   POST /api/student/component-requests
============================ */
router.post('/', requestComponent);

/* ============================
   GET MY COMPONENT REQUESTS
   GET /api/student/component-requests
============================ */
router.get('/', getMyComponentRequests);

module.exports = router;