const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueTransaction,
  returnTransaction,
  getActiveTransactions,
  getPendingTransactions,
  getAvailableAssetsByItem,
  searchPendingTransactions,   // ✅ new
  searchActiveTransactions,    // ✅ new
} = require('../../controllers/assistant.controller');

// 🔐 Assistant only
router.use(auth, role('assistant'));

/* ============================
   STATIC ROUTES FIRST
   (must be before /:transaction_id routes
   to avoid param collision)
============================ */

router.get('/pending',                getPendingTransactions);
router.get('/pending/search',         searchPendingTransactions);  // ✅ new

router.get('/active',                 getActiveTransactions);
router.get('/active/search',          searchActiveTransactions);   // ✅ new

router.get('/assets/:itemId/available', getAvailableAssetsByItem);

/* ============================
   PARAM ROUTES LAST
============================ */

router.post('/:transaction_id/issue',   issueTransaction);
router.post('/:transaction_id/return',  returnTransaction);

module.exports = router;