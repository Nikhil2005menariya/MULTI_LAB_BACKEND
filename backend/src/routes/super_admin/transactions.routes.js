const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueTransaction,
  returnTransaction,
  getActiveTransactions,
  getPendingTransactions,
  getAvailableAssetsByItem
} = require('../../controllers/super_admin.controller');

router.use(auth, role('super_admin'));

// /* Issue items */
// router.post('/issue/:transaction_id', issueTransaction);

// /* Return items */
// router.post('/return/:transaction_id', returnTransaction);

/* View transactions */
router.get('/pending', getPendingTransactions);
router.get('/active', getActiveTransactions);

/* Available assets */
router.get('/assets/:itemId/available', getAvailableAssetsByItem);

module.exports = router;