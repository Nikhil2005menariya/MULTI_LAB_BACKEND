const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  raiseTransaction,
  getMyTransactions,
  getTransactionById,
  extendReturnDate,
} = require('../../controllers/student.controller');

/* =====================================================
   STUDENT TRANSACTION ROUTES
   Base Path: /api/student/transactions
===================================================== */

// 🔐 Student-only access
router.use(auth, role('student'));

/* ============================
   RAISE NEW TRANSACTION
   POST /api/student/transactions
============================ */
router.post('/', raiseTransaction);

/* ============================
   GET MY TRANSACTION HISTORY
   GET /api/student/transactions/my
============================ */
router.get('/my', getMyTransactions);

/* ============================
   GET TRANSACTION BY ID
   GET /api/student/transactions/:transaction_id
============================ */
router.get('/:transaction_id', getTransactionById);


router.patch('/:transaction_id/extend', extendReturnDate);
module.exports = router;