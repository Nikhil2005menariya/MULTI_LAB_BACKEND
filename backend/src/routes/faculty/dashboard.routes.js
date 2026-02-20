const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const facultyController = require('../../controllers/faculty.controller');

/* ============================
   PROTECTED FACULTY ROUTES
============================ */

// Faculty must be logged in
router.use(auth, role('faculty'));

// Get faculty profile
router.get('/profile', facultyController.getFacultyProfile);

// All transactions linked to faculty
router.get('/transactions', facultyController.getAllTransactions);

// Pending approvals
router.get('/transactions/pending', facultyController.getPendingTransactions);

// Transaction details
router.get('/transactions/:transaction_id', facultyController.getTransactionDetails);

// Approve via dashboard
router.patch('/transactions/:transaction_id/approve', facultyController.approveTransactionByFaculty);

// Reject via dashboard
router.patch('/transactions/:transaction_id/reject', facultyController.rejectTransactionByFaculty);

module.exports = router;
