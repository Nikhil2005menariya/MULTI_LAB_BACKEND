const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getAllItems,
  getItemById,
  getItemAssets,
  getLabAvailableItems
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – INVENTORY
   Base: /api/super-admin/labs/:labId/items
===================================================== */

router.use(auth, role('super_admin'));

/* Get all items */
router.get('/', getAllItems);

/* Get available items */
router.get('/available', getLabAvailableItems);

/* Get single item */
router.get('/:id', getItemById);

/* Get item assets */
router.get('/:id/assets', getItemAssets);

module.exports = router;