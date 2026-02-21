const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getTransactionHistory,
  searchTransactions
} = require('../../controllers/admin.controller');

router.use(auth, role('incharge'));
// GET all transactions (history)
router.get('/history', getTransactionHistory);

// GET search transactions
router.get('/search', searchTransactions);

module.exports = router;
