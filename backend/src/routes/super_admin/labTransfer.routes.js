const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  validateObjectId,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  getLabTransfers,
  getLabTransferDetail,
  getIncomingTransfers,
  getOutgoingTransfers
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB TRANSFER ROUTES
   Base: /api/super-admin/labs/:labId/transfers
   Auth applied at index.js level
===================================================== */

/* ============================
   GET ALL LAB TRANSFERS
   (Incoming + Outgoing)
   GET /labs/:labId/transfers
============================ */
router.get('/', validatePaginationParams, getLabTransfers);

/* ============================
   GET SINGLE TRANSFER
   GET /labs/:labId/transfers/:id
============================ */
router.get('/:id', validateObjectId('id'), getLabTransferDetail);

module.exports = router;
