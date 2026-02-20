const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueLabTransfer,
  getActiveLabTransfers
} = require('../../controllers/incharge.controller');

router.use(auth, role('incharge'));

/**
 * POST /api/incharge/lab-transfer/issue
 */
router.post('/issue', issueLabTransfer);
router.get('/active', getActiveLabTransfers);

module.exports = router;
