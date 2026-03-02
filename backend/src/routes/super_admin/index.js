const express = require('express');
const router = express.Router();

router.use('/labs', require('./labs.routes'));
router.use('/analytics', require('./analytics.routes'));
router.use('/labs/:labId', require('./staff.routes'));
router.use('/labs/:labId/items', require('./inventory.routes'));
router.use('/labs/:labId/transactions', require('./transactions.routes'));
router.use('/labs/:labId/lab-sessions', require('./labSession.routes'));
router.use('/labs/:labId/transfers', require('./labTransfer.routes'));
router.use('/labs/:labId/component-requests', require('./componentRequests.routes'));
router.use('/labs/:labId/bills', require('./bills.routes'));
router.use('/labs/:labId/damaged-assets', require('./damagedAssets.routes'));

module.exports = router;