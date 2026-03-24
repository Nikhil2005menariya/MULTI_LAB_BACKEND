const express = require('express');
const router = express.Router();

const {
  validateObjectId,
  validatePaginationParams,
  sanitizeSearch
} = require('../../middlewares/paramValidator.middleware');

const {
  getAllItems,
  getItemLabs
} = require('../../controllers/student.controller');

/* =====================================================
   STUDENT ITEM ROUTES
   Base Path: /api/student/items
   Auth applied at index.js level
===================================================== */

/* ============================
   GET ALL AVAILABLE ITEMS
   GET /api/student/items
============================ */
router.get(
  '/',
  sanitizeSearch(['q', 'query', 'search']),
  validatePaginationParams,
  getAllItems
);

/* ============================
   GET LAB-WISE AVAILABILITY FOR ITEM
   GET /api/student/items/:item_id/labs
============================ */
router.get(
  '/:item_id/labs',
  validateObjectId('item_id'),
  getItemLabs
);

module.exports = router;
