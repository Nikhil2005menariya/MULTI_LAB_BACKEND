const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getAnalyticsOverview,
  getTransactionReport,
  getItemReport,
  getLabComparison,
  getOverdueReport,
  getDamageReport,
} = require('../../controllers/super_admin.controller');

router.use(auth, role('super_admin'));

// GET /api/super-admin/analytics/overview?labId=&startDate=&endDate=
router.get('/overview', getAnalyticsOverview);

// POST /api/super-admin/analytics/transactions
router.post('/transactions', getTransactionReport);

// POST /api/super-admin/analytics/items
router.post('/items', getItemReport);

// GET /api/super-admin/analytics/labs/compare?startDate=&endDate=
router.get('/labs/compare', getLabComparison);

// GET /api/super-admin/analytics/overdue?labId=&page=&limit=
router.get('/overdue', getOverdueReport);

// GET /api/super-admin/analytics/damage?labId=&startDate=&endDate=&page=&limit=
router.get('/damage', getDamageReport);

module.exports = router;