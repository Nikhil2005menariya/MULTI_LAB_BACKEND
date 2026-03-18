const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getTransactionHistory,
  searchTransactions,
  getAdminDashboard
} = require('../../controllers/admin.controller');
const { route } = require('./items.routes');

router.use(auth, role('incharge'));
// GET all transactions (history)
router.get('/history', getTransactionHistory);

// GET search transactions
router.get('/search', searchTransactions);

router.get('/dashboard',getAdminDashboard);

module.exports = router;
