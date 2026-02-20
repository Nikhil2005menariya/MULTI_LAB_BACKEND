const express = require('express');
const router = express.Router();

const {
  getApprovalDetails,
  approveTransaction,
  rejectTransaction,
} = require('../../controllers/faculty.controller');

/**
 * ⚠️ IMPORTANT
 * These routes must NOT use auth middleware
 * Approval is token-based
 */

// READ (load approval page)
router.get('/approve/details', getApprovalDetails);

// ACTIONS
router.post('/approve', approveTransaction);
router.post('/reject', rejectTransaction);

module.exports = router;
