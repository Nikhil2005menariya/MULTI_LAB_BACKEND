const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const {
  validateObjectId,
  validateLabId,
  sanitizeSearch,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  getLabSessions,
  getLabSessionDetail,
  getLabTransfers,
  getLabTransferDetail,
  getAllLabs,
  getLabAvailableItems,
  createTransferRequest,
  getIncomingTransfers,
  getOutgoingTransfers,
  decideTransferRequest,
  initiateReturn,
  completeReturn,
  searchLabSessions,
  searchLabTransfers,
} = require('../../controllers/admin.controller');

// Only lab incharge & assistant
router.use(auth, role('incharge', 'assistant'));

/* ===== LAB SESSIONS ===== */
router.get('/lab-sessions', validatePaginationParams, getLabSessions);
router.get('/lab-sessions/search', sanitizeSearch(['q', 'query']), validatePaginationParams, searchLabSessions);
router.get('/lab-sessions/:id', validateObjectId('id'), getLabSessionDetail);

/* ===== LAB TRANSFERS ===== */
router.get('/lab-transfers', validatePaginationParams, getLabTransfers);
router.get('/lab-transfers/search', sanitizeSearch(['q', 'query']), validatePaginationParams, searchLabTransfers);
router.get('/lab-transfers/:id', validateObjectId('id'), getLabTransferDetail);

/* =========================
   LAB LISTING
========================= */
router.get('/labs', getAllLabs);
router.get('/labs/:labId/items', validateLabId('labId'), getLabAvailableItems);

/* =========================
   TRANSFER REQUESTS
========================= */
router.post('/transfers', createTransferRequest);
router.get('/transfers/incoming', validatePaginationParams, getIncomingTransfers);
router.get('/transfers/outgoing', validatePaginationParams, getOutgoingTransfers);

/* =========================
   DECISION FLOW
========================= */
router.post('/transfers/:id/decision', validateObjectId('id'), decideTransferRequest);

/* =========================
   TEMP RETURN FLOW
========================= */
router.post('/transfers/:id/initiate-return', validateObjectId('id'), initiateReturn);
router.post('/transfers/:id/complete-return', validateObjectId('id'), completeReturn);

module.exports = router;
