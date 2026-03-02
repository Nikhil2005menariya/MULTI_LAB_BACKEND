const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

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
===================================================== */

// 🔐 Assistant only
router.use(auth, role('assistant'));

/* ============================
   GET RESERVED ITEMS (LAB)
   GET /api/assistant/lab-sessions/items
============================ */
router.get('/items', getAvailableLabItems);

/* ============================
   SEARCH RESERVED ITEMS
   GET /api/assistant/lab-sessions/items/search?q=...
============================ */
router.get('/items/search', searchLabItems);

/* ============================
   ISSUE LAB SESSION
   POST /api/assistant/lab-sessions/issue
============================ */
router.post('/issue', issueLabSession);

/* ============================
   GET ACTIVE LAB SESSIONS
   GET /api/assistant/lab-sessions/active
============================ */
router.get('/active', getActiveLabSessions);

/* ============================
   RETURN LAB SESSION
   POST /api/assistant/lab-sessions/:transaction_id/return
============================ */
router.post('/:transaction_id/return', returnTransaction);

module.exports = router;