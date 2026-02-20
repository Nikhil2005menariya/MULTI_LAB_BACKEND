const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueTransaction,
  returnTransaction,
  getActiveTransactions,
  getPendingTransactions,
  getAvailableAssetsByItem,

} = require('../../controllers/incharge.controller');

// protect all in-charge routes
router.use(auth, role('incharge'));

// issue items (approved → active)
router.post('/issue/:transaction_id', issueTransaction);

// return items (active → completed)
router.post('/return/:transaction_id', returnTransaction);

router.get('/pending', getPendingTransactions);
router.get('/active', getActiveTransactions);
router.get('/assets/:itemId/available', getAvailableAssetsByItem);

module.exports = router;
