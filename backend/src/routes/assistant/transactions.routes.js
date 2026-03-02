const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueTransaction,
  returnTransaction,
  getActiveTransactions,
  getPendingTransactions,
  getAvailableAssetsByItem
} = require('../../controllers/assistant.controller');

/* =====================================================
   ASSISTANT TRANSACTION ROUTES
   Base Path: /api/assistant/transactions
===================================================== */

// 🔐 Assistant only
router.use(auth, role('assistant'));

/* ============================
   GET APPROVED TRANSACTIONS
============================ */
router.get('/pending', getPendingTransactions);

/* ============================
   GET ACTIVE TRANSACTIONS
============================ */
router.get('/active', getActiveTransactions);

/* ============================
   ISSUE TRANSACTION
============================ */
router.post('/:transaction_id/issue', issueTransaction);

/* ============================
   RETURN TRANSACTION
============================ */
router.post('/:transaction_id/return', returnTransaction);

/* ============================
   GET AVAILABLE ASSETS
============================ */
router.get('/assets/:itemId/available', getAvailableAssetsByItem);

module.exports = router;