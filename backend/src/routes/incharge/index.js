const express = require('express');
const router = express.Router();



router.use('/transactions', require('./transactions.routes'));
router.use('/profile', require('./profile.routes'));
router.use('/lab-session', require('./labSession.routes'));
router.use('/lab-transfer', require('./labTransfer.routes'));


module.exports = router;
