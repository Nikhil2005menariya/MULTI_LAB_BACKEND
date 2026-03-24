const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

// Apply auth and role middleware to all assistant routes
router.use(auth, role('assistant'));

router.use('/transactions', require('./transactions.routes'));
router.use('/profile', require('./profile.routes'));
router.use('/lab-sessions', require('./labSession.routes'));

module.exports = router;
