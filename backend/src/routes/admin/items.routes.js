const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

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
router.post('/:id/mark-damaged', markAssetDamaged);

// PUT - update item details / quantity
router.put('/:id', updateItem);

// DELETE - soft delete item
router.delete('/:id', removeItem);

router.get('/search', searchItemsByPrefix);

// GET - asset transaction history (must be before /:id routes that end with different paths)
router.get('/:id/assets/:assetTag/transactions', getAssetTransactionHistory);

// GET - view all items
router.get('/', getAllItems);

// GET - view single item
router.get('/:id', getItemById);

// GET - item assets
router.get('/:id/assets', getItemAssets);


module.exports = router;
