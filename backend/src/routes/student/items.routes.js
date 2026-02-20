const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getAllItems,
  getItemLabs
} = require('../../controllers/student.controller');

/* =====================================================
   STUDENT ITEM ROUTES
   Base Path: /api/student/items
===================================================== */

// 🔐 Student-only access
router.use(auth, role('student'));

/* ============================
   GET ALL AVAILABLE ITEMS
   GET /api/student/items
============================ */
router.get('/', getAllItems);

/* ============================
   GET LAB-WISE AVAILABILITY FOR ITEM
   GET /api/student/items/:item_id/labs
============================ */
router.get('/:item_id/labs', getItemLabs);

module.exports = router;