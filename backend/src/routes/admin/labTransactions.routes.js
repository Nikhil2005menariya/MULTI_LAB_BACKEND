const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

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
} = require('../../controllers/admin.controller');

// 🔒 Only lab incharge & assistant
router.use(auth, role('incharge', 'assistant'));

/* ===== LAB SESSIONS ===== */
router.get('/lab-sessions', getLabSessions);
router.get('/lab-sessions/:id', getLabSessionDetail);

/* ===== LAB TRANSFERS ===== */
router.get('/lab-transfers', getLabTransfers);
router.get('/lab-transfers/:id', getLabTransferDetail);


/* =========================
   LAB LISTING
========================= */
router.get('/labs', getAllLabs);
router.get('/labs/:labId/items', getLabAvailableItems);

/* =========================
   TRANSFER REQUESTS
========================= */
router.post('/transfers', createTransferRequest);
router.get('/transfers/incoming', getIncomingTransfers);
router.get('/transfers/outgoing', getOutgoingTransfers);

/* =========================
   DECISION FLOW
========================= */
router.post('/transfers/:id/decision', decideTransferRequest);

/* =========================
   TEMP RETURN FLOW
========================= */
router.post('/transfers/:id/initiate-return', initiateReturn);
router.post('/transfers/:id/complete-return', completeReturn);

module.exports = router;
