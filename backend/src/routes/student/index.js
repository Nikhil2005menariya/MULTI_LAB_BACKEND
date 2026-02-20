const express = require('express');
const router = express.Router();

/* =====================================================
   STUDENT ROUTE GROUP
   Base Path: /api/student
===================================================== */

router.use('/items', require('./items.routes'));
router.use('/transactions', require('./transactions.routes'));
router.use('/component-requests', require('./componentRequest.routes'));

module.exports = router;