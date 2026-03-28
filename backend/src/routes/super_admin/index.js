const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const { validateLabId } = require('../../middlewares/paramValidator.middleware');

// Apply auth and role middleware to all super_admin routes
router.use(auth, role('super_admin'));

// Standalone routes
router.use('/labs', require('./labs.routes'));
router.use('/analytics', require('./analytics.routes'));
router.use('/profile', require('./profile.routes'));

// Lab-specific routes with labId validation
router.use('/labs/:labId', validateLabId('labId'), require('./staff.routes'));
router.use('/labs/:labId/items', validateLabId('labId'), require('./inventory.routes'));
router.use('/labs/:labId/transactions', validateLabId('labId'), require('./transactions.routes'));
router.use('/labs/:labId/lab-sessions', validateLabId('labId'), require('./labSession.routes'));
router.use('/labs/:labId/transfers', validateLabId('labId'), require('./labTransfer.routes'));
router.use('/labs/:labId/component-requests', validateLabId('labId'), require('./componentRequests.routes'));
router.use('/labs/:labId/bills', validateLabId('labId'), require('./bills.routes'));
router.use('/labs/:labId/damaged-assets', validateLabId('labId'), require('./damagedAssets.routes'));

module.exports = router;

