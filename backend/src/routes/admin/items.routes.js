const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const { validateObjectId, validateAssetTag, sanitizeSearch } = require('../../middlewares/paramValidator.middleware');

const {
  addItem,
  updateItem,
  removeItem,
  getAllItems,
  getItemById,
  getItemAssets,
  searchItemsByPrefix,
  markAssetDamaged,
  getAssetTransactionHistory,
} = require('../../controllers/admin.controller');

router.use(auth, role('incharge'));

// POST - add new item
router.post('/', addItem);

// POST - mark asset as damaged
router.post('/:id/mark-damaged', validateObjectId('id'), markAssetDamaged);

// PUT - update item details / quantity
router.put('/:id', validateObjectId('id'), updateItem);

// DELETE - soft delete item
router.delete('/:id', validateObjectId('id'), removeItem);

// GET - search items (sanitize search query)
router.get('/search', sanitizeSearch(['q', 'query', 'prefix']), searchItemsByPrefix);

// GET - asset transaction history (validate both params)
router.get(
  '/:id/assets/:assetTag/transactions',
  validateObjectId('id'),
  validateAssetTag('assetTag'),
  getAssetTransactionHistory
);

// GET - view all items
router.get('/', getAllItems);

// GET - view single item
router.get('/:id', validateObjectId('id'), getItemById);

// GET - item assets
router.get('/:id/assets', validateObjectId('id'), getItemAssets);


module.exports = router;
