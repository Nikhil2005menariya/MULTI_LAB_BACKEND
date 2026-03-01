const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueLabTransfer,
  getActiveLabTransfers
} = require('../../controllers/super_admin.controller');

router.use(auth, role('super_admin'));

/* Issue lab transfer */
// router.post('/issue', issueLabTransfer);

/* Active transfers */
router.get('/active', getActiveLabTransfers);

module.exports = router;