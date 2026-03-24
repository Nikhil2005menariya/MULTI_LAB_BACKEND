const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  validateObjectId,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  getBills,
  downloadBill
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – BILLS
   Auth applied at index.js level
===================================================== */

/* Get bills */
router.get('/', validatePaginationParams, getBills);

/* Download bill */
router.get('/:id/download', validateObjectId('id'), downloadBill);

module.exports = router;
