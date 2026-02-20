const express = require('express');
const router = express.Router();

const {
  addItem,
  updateItem,
  removeItem,
  getAllItems,
  getItemById,
  getItemAssets, // 👈 ADD
} = require('../../controllers/admin.controller');

// POST - add new item
router.post('/', addItem);

// PUT - update item details / quantity
router.put('/:id', updateItem);

// DELETE - soft delete item
router.delete('/:id', removeItem);

// GET - view all items
router.get('/', getAllItems);

// GET - view single item
router.get('/:id', getItemById);

// GET - item assets (NEW ✅)
router.get('/:id/assets', getItemAssets);

module.exports = router;
