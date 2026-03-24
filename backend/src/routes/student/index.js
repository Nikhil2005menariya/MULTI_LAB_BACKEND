const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

/* =====================================================
   STUDENT ROUTE GROUP
   Base Path: /api/student
===================================================== */

// Apply auth and role middleware to all student routes
router.use(auth, role('student'));

router.use('/items', require('./items.routes'));
router.use('/transactions', require('./transactions.routes'));
router.use('/component-requests', require('./componentRequest.routes'));
router.use('/profile', require('./profile.routes'));

module.exports = router;
