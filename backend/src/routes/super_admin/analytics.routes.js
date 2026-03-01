const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getTransactionAnalytics,
  getItemAnalytics
} = require('../../controllers/super_admin.controller');


router.use(auth, role('super_admin'));

router.post('/items', getItemAnalytics);
router.post('/transactions', getTransactionAnalytics);

module.exports = router;