const express = require('express');
const router = express.Router({ mergeParams: true });

const { validatePaginationParams } = require('../../middlewares/paramValidator.middleware');

const {
  getDamagedAssetHistory
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – DAMAGED ASSET HISTORY
   Auth applied at index.js level
===================================================== */

/* Get damaged asset logs */
router.get('/', validatePaginationParams, getDamagedAssetHistory);

module.exports = router;
