const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getDamagedAssetHistory
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – DAMAGED ASSET HISTORY
===================================================== */

router.use(auth, role('super_admin'));

/* Get damaged asset logs */
router.get('/', getDamagedAssetHistory);

module.exports = router;