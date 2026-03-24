const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const { validateObjectId, validateStatus } = require('../../middlewares/paramValidator.middleware');

const {
  getDamagedAssetHistory,
  getCurrentDamagedAssets,
  getUnderRepairAssets,
  updateDamageStatus,
  getDamagedAssetDetail
} = require('../../controllers/admin.controller');

router.use(auth, role('incharge'));

// GET /api/admin/damaged-assets/history
router.get('/history', getDamagedAssetHistory);

// GET /api/admin/damaged-assets/under-repair/list
router.get('/under-repair/list', getUnderRepairAssets);

// GET /api/admin/damaged-assets
router.get('/', getCurrentDamagedAssets);

// PATCH /api/admin/damaged-assets/:id/status
router.patch(
  '/:id/status',
  validateObjectId('id'),
  validateStatus(['damaged', 'under_repair', 'repaired', 'disposed']),
  updateDamageStatus
);

// GET /api/admin/damaged-assets/:id (MUST BE LAST)
router.get('/:id', validateObjectId('id'), getDamagedAssetDetail);

module.exports = router;
