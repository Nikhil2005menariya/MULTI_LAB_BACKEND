const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getTransactionAnalytics,
  getItemAnalytics
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN ANALYTICS ROUTES
===================================================== */

router.use(auth, role('super_admin'));

/* ============================
   ITEM ANALYTICS
   POST /api/super-admin/analytics/items
============================ */
router.post('/items', getItemAnalytics);

/* ============================
   TRANSACTION ANALYTICS
   POST /api/super-admin/analytics/transactions
============================ */
router.post('/transactions', getTransactionAnalytics);

module.exports = router;