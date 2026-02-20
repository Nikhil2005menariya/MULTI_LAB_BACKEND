const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  raiseTransaction,
  getMyTransactions,
  getTransactionById
} = require('../../controllers/student.controller');

// all student routes protected
router.use(auth, role('student'));

// raise transaction
router.post('/', raiseTransaction);

// student transaction history
router.get('/my', getMyTransactions);

// track by transaction id
router.get('/:transaction_id', getTransactionById);

module.exports = router;
