const express = require('express');
const router = express.Router();

const {
  validateObjectId,
  validateTransactionId,
  sanitizeSearch,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  issueTransaction,
  returnTransaction,
  getActiveTransactions,
  getPendingTransactions,
  getAvailableAssetsByItem,
  searchPendingTransactions,
  searchActiveTransactions,
} = require('../../controllers/assistant.controller');

/* =====================================================
   ASSISTANT TRANSACTION ROUTES
   Auth applied at index.js level
===================================================== */

/* ============================
   STATIC ROUTES FIRST
   (must be before /:transaction_id routes
   to avoid param collision)
============================ */

router.get('/pending', validatePaginationParams, getPendingTransactions);
router.get(
  '/pending/search',
  sanitizeSearch(['q', 'query', 'search']),
  validatePaginationParams,
  searchPendingTransactions
);

router.get('/active', validatePaginationParams, getActiveTransactions);
router.get(
  '/active/search',
  sanitizeSearch(['q', 'query', 'search']),
  validatePaginationParams,
  searchActiveTransactions
);

router.get(
  '/assets/:itemId/available',
  validateObjectId('itemId'),
  getAvailableAssetsByItem
);

/* ============================
   PARAM ROUTES LAST
============================ */

router.post(
  '/:transaction_id/issue',
  validateTransactionId('transaction_id'),
  issueTransaction
);

router.post(
  '/:transaction_id/return',
  validateTransactionId('transaction_id'),
  returnTransaction
);

module.exports = router;
