const express = require('express');
const router = express.Router();

const {
   validateTransactionId,
  sanitizeSearch,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  issueLabSession,
  getAvailableLabItems,
  searchLabItems,
  getActiveLabSessions,
  returnTransaction
} = require('../../controllers/assistant.controller');

/* =====================================================
   ASSISTANT LAB SESSION ROUTES
   Base Path: /api/assistant/lab-sessions
   Auth applied at index.js level
===================================================== */

/* ============================
   GET RESERVED ITEMS (LAB)
   GET /api/assistant/lab-sessions/items
============================ */
router.get('/items', validatePaginationParams, getAvailableLabItems);

/* ============================
   SEARCH RESERVED ITEMS
   GET /api/assistant/lab-sessions/items/search?q=...
============================ */
router.get(
  '/items/search',
  sanitizeSearch(['q', 'query', 'search']),
  validatePaginationParams,
  searchLabItems
);

/* ============================
   ISSUE LAB SESSION
   POST /api/assistant/lab-sessions/issue
============================ */
router.post('/issue', issueLabSession);

/* ============================
   GET ACTIVE LAB SESSIONS
   GET /api/assistant/lab-sessions/active
============================ */
router.get('/active', validatePaginationParams, getActiveLabSessions);

/* ============================
   RETURN LAB SESSION
   POST /api/assistant/lab-sessions/:transaction_id/return
============================ */
router.post(
  '/:transaction_id/return',
   validateTransactionId('transaction_id'),
  returnTransaction
);

module.exports = router;
