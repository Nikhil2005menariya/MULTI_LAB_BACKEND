const express = require('express');
const router = express.Router();

const { validatePaginationParams } = require('../../middlewares/paramValidator.middleware');

const {
  requestComponent,
  getMyComponentRequests,
  getAllLabsForStudents,
} = require('../../controllers/student.controller');

/* =====================================================
   STUDENT COMPONENT REQUEST ROUTES
   Base Path: /api/student/component-requests
   Auth applied at index.js level
===================================================== */

// Get all labs for component requests
router.get('/labs', getAllLabsForStudents);

/* ============================
   CREATE COMPONENT REQUEST
   POST /api/student/component-requests
============================ */
router.post('/', requestComponent);

/* ============================
   GET MY COMPONENT REQUESTS
   GET /api/student/component-requests
============================ */
router.get('/', validatePaginationParams, getMyComponentRequests);

module.exports = router;
