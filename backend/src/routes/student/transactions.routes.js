const express = require('express');
const router = express.Router();

const {
  validateObjectId,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  raiseTransaction,
  getMyTransactions,
  getTransactionById,
  extendReturnDate,
} = require('../../controllers/student.controller');

/* =====================================================
   STUDENT TRANSACTION ROUTES
   Base Path: /api/student/transactions
   Auth applied at index.js level
===================================================== */

/* ============================
   RAISE NEW TRANSACTION
   POST /api/student/transactions
============================ */
router.post('/', raiseTransaction);

/* ============================
   GET MY TRANSACTION HISTORY
   GET /api/student/transactions/my
============================ */
router.get('/my', validatePaginationParams, getMyTransactions);

/* ============================
   GET TRANSACTION BY ID
   GET /api/student/transactions/:transaction_id
============================ */
router.get(
  '/:transaction_id',
  validateObjectId('transaction_id'),
  getTransactionById
);

/* ============================
   EXTEND RETURN DATE
   PATCH /api/student/transactions/:transaction_id/extend
============================ */
router.patch(
  '/:transaction_id/extend',
  validateObjectId('transaction_id'),
  extendReturnDate
);

module.exports = router;
