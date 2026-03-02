const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getTransactionHistory,
  searchTransactions,
  getOverdueTransactions
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB TRANSACTIONS
   Base: /api/super-admin/labs/:labId/transactions
===================================================== */

router.use(auth, role('super_admin'));

/* ============================
   GET ALL TRANSACTIONS
   GET /labs/:labId/transactions
============================ */
router.get('/', getTransactionHistory);

/* ============================
   SEARCH TRANSACTIONS
   GET /labs/:labId/transactions/search
============================ */
router.get('/search', searchTransactions);

/* ============================
   GET OVERDUE TRANSACTIONS
   GET /labs/:labId/transactions/overdue
============================ */
router.get('/overdue', getOverdueTransactions);

module.exports = router;