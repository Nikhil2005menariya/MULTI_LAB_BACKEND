const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getAllComponentRequests,
  getComponentRequestById
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – COMPONENT REQUESTS
===================================================== */

router.use(auth, role('super_admin'));

/* Get all requests */
router.get('/', getAllComponentRequests);

/* Get single request */
router.get('/:id', getComponentRequestById);

module.exports = router;