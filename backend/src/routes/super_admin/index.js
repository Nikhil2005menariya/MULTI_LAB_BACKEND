const express = require('express');
const router = express.Router();

router.use('/labs', require('./labs.routes'));
router.use('/labs', require('./staff.routes'));
router.use('/labs/:labId/transactions', require('./transactions.routes'));
router.use('/labs/:labId/lab-session', require('./labSession.routes'));
router.use('/labs/:labId/lab-transfer', require('./labTransfer.routes'));
router.use('/analytics', require('./analytics.routes'));

module.exports = router;