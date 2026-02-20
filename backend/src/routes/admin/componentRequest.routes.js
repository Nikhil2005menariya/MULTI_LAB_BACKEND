const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getAllComponentRequests,
  getComponentRequestById,
  updateComponentRequestStatus
} = require('../../controllers/admin.controller');

// 🔒 Admin only
router.use(auth, role('admin'));

/**
 * GET /api/admin/component-requests
 */
router.get('/', getAllComponentRequests);

/**
 * GET /api/admin/component-requests/:id
 */
router.get('/:id', getComponentRequestById);

/**
 * PATCH /api/admin/component-requests/:id/status
 */
router.patch('/:id/status', updateComponentRequestStatus);

module.exports = router;
