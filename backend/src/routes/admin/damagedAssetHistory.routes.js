const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getDamagedAssetHistory
} = require('../../controllers/admin.controller');

router.use(auth, role('admin'));

router.get('/history', getDamagedAssetHistory);

module.exports = router;
