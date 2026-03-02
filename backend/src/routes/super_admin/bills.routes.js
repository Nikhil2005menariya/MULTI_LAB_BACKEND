const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getBills,
  downloadBill
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – BILLS
===================================================== */

router.use(auth, role('super_admin'));

/* Get bills */
router.get('/', getBills);

/* Download bill */
router.get('/:id/download', downloadBill);

module.exports = router;