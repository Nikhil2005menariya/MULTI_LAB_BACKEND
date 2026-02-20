const express = require('express');
const router = express.Router();

const {
  getTransactionHistory,
  searchTransactions
} = require('../../controllers/admin.controller');

// GET all transactions (history)
router.get('/history', getTransactionHistory);

// GET search transactions
router.get('/search', searchTransactions);

module.exports = router;
