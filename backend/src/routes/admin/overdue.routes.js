const express = require('express');
const router = express.Router();

const { getOverdueTransactions } = require('../../controllers/admin.controller');

router.get('/', getOverdueTransactions);

module.exports = router;
