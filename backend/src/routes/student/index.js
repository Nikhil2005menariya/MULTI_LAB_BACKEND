const express = require('express');
const router = express.Router();

router.use('/transactions', require('./transactions.routes'));
router.use('/items', require('./items.routes'));
router.use('/component-requests', require('./componentRequest.routes'));

module.exports = router;
