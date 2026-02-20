const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getLabSessions,
  getLabSessionDetail,
  getLabTransfers,
  getLabTransferDetail
} = require('../../controllers/admin.controller');

// 🔒 Admin only
router.use(auth, role('admin'));

/* ===== LAB SESSIONS ===== */
router.get('/lab-sessions', getLabSessions);
router.get('/lab-sessions/:id', getLabSessionDetail);

/* ===== LAB TRANSFERS ===== */
router.get('/lab-transfers', getLabTransfers);
router.get('/lab-transfers/:id', getLabTransferDetail);

module.exports = router;
