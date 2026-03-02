const express = require('express');
const router = express.Router();



router.use('/transactions', require('./transactions.routes'));
router.use('/profile', require('./profile.routes'));
router.use('/lab-sessions', require('./labSession.routes'));

module.exports = router;
