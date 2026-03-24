const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  validatePaginationParams,
  sanitizeSearch
} = require('../../middlewares/paramValidator.middleware');

const {
  getTransactionHistory,
  searchTransactions,
  getOverdueTransactions
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB TRANSACTIONS
   Base: /api/super-admin/labs/:labId/transactions
   Auth applied at index.js level
===================================================== */

/* ============================
   GET ALL TRANSACTIONS
   GET /labs/:labId/transactions
============================ */
router.get('/', validatePaginationParams, getTransactionHistory);

/* ============================
   SEARCH TRANSACTIONS
   GET /labs/:labId/transactions/search
============================ */
router.get(
  '/search',
  sanitizeSearch(['q', 'query', 'search']),
  validatePaginationParams,
  searchTransactions
);

/* ============================
   GET OVERDUE TRANSACTIONS
   GET /labs/:labId/transactions/overdue
============================ */
router.get('/overdue', validatePaginationParams, getOverdueTransactions);

module.exports = router;
