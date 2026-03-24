const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  validateObjectId,
  validatePaginationParams,
  sanitizeSearch
} = require('../../middlewares/paramValidator.middleware');

const {
  getAllItems,
  getItemById,
  getItemAssets,
  getLabAvailableItems
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – INVENTORY
   Base: /api/super-admin/labs/:labId/items
   Auth applied at index.js level
===================================================== */

/* Get all items */
router.get(
  '/',
  sanitizeSearch(['q', 'query', 'search']),
  validatePaginationParams,
  getAllItems
);

/* Get available items */
router.get('/available', validatePaginationParams, getLabAvailableItems);

/* Get single item */
router.get('/:id', validateObjectId('id'), getItemById);

/* Get item assets */
router.get('/:id/assets', validateObjectId('id'), getItemAssets);

module.exports = router;
