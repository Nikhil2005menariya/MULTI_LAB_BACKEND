const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  validateObjectId,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  getAllComponentRequests,
  getComponentRequestById
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – COMPONENT REQUESTS
   Auth applied at index.js level
===================================================== */

/* Get all requests */
router.get('/', validatePaginationParams, getAllComponentRequests);

/* Get single request */
router.get('/:id', validateObjectId('id'), getComponentRequestById);

module.exports = router;
