const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const {
  sanitizeSearch,
  validatePaginationParams,
  validateDateRange
} = require('../../middlewares/paramValidator.middleware');

const {
  getTransactionHistory,
  searchTransactions,
  getAdminDashboard
} = require('../../controllers/admin.controller');

router.use(auth, role('incharge'));

// GET all transactions (history) with pagination and date range validation
router.get(
  '/history',
  validatePaginationParams,
  validateDateRange('startDate', 'endDate'),
  getTransactionHistory
);

// GET search transactions with sanitized search
router.get(
  '/search',
  sanitizeSearch(['q', 'query', 'search']),
  validatePaginationParams,
  searchTransactions
);

// Dashboard
router.get('/dashboard', getAdminDashboard);

module.exports = router;
