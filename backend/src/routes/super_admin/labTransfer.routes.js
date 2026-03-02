const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getLabTransfers,
  getLabTransferDetail,
  getIncomingTransfers,
  getOutgoingTransfers
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB TRANSFER ROUTES
   Base: /api/super-admin/labs/:labId/transfers
===================================================== */

router.use(auth, role('super_admin'));

/* ============================
   GET ALL LAB TRANSFERS
   (Incoming + Outgoing)
   GET /labs/:labId/transfers
============================ */
router.get('/', getLabTransfers);

/* ============================
   GET INCOMING TRANSFERS
   GET /labs/:labId/transfers/incoming
============================ */
/* ============================
   GET SINGLE TRANSFER
   GET /labs/:labId/transfers/:id
============================ */
router.get('/:id', getLabTransferDetail);

module.exports = router;