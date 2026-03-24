const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const { validateObjectId, validateStatus } = require('../../middlewares/paramValidator.middleware');

const {
  getAllComponentRequests,
  getComponentRequestById,
  updateComponentRequestStatus
} = require('../../controllers/admin.controller');

// Admin only
router.use(auth, role('incharge'));

// GET /api/admin/component-requests
router.get('/', getAllComponentRequests);

// GET /api/admin/component-requests/:id
router.get('/:id', validateObjectId('id'), getComponentRequestById);

// PATCH /api/admin/component-requests/:id/status
router.patch(
  '/:id/status',
  validateObjectId('id'),
  validateStatus(['pending', 'approved', 'rejected', 'fulfilled']),
  updateComponentRequestStatus
);

module.exports = router;
