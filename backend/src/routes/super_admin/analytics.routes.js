const express = require('express');
const router = express.Router();

const {
  validatePaginationParams,
  validateDateRange
} = require('../../middlewares/paramValidator.middleware');

const {
  getAnalyticsOverview,
  getTransactionReport,
  getItemReport,
  getLabComparison,
  getOverdueReport,
  getDamageReport,
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – ANALYTICS
   Auth applied at index.js level
===================================================== */

// GET /api/super-admin/analytics/overview?labId=&startDate=&endDate=
router.get(
  '/overview',
  validateDateRange('startDate', 'endDate'),
  getAnalyticsOverview
);

// POST /api/super-admin/analytics/transactions
router.post(
  '/transactions',
  validateDateRange('startDate', 'endDate'),
  getTransactionReport
);

// POST /api/super-admin/analytics/items
router.post('/items', getItemReport);

// GET /api/super-admin/analytics/labs/compare?startDate=&endDate=
router.get(
  '/labs/compare',
  validateDateRange('startDate', 'endDate'),
  getLabComparison
);

// GET /api/super-admin/analytics/overdue?labId=&page=&limit=
router.get(
  '/overdue',
  validatePaginationParams,
  getOverdueReport
);

// GET /api/super-admin/analytics/damage?labId=&startDate=&endDate=&page=&limit=
router.get(
  '/damage',
  validateDateRange('startDate', 'endDate'),
  validatePaginationParams,
  getDamageReport
);

module.exports = router;
