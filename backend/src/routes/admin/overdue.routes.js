const express = require('express');
const router = express.Router();

const { getOverdueTransactions } = require('../../controllers/admin.controller');
const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const { validatePaginationParams } = require('../../middlewares/paramValidator.middleware');

router.use(auth, role('incharge'));
router.get('/', validatePaginationParams, getOverdueTransactions);

module.exports = router;
