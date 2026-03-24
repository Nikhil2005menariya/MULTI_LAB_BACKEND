const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  validateObjectId,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  getLabSessions,
  getLabSessionDetail,
  getLabAvailableItems
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB SESSION ROUTES
   Base: /api/super-admin/labs/:labId/lab-sessions
   Auth applied at index.js level
===================================================== */

/* ============================
   GET ALL LAB SESSIONS
   GET /labs/:labId/lab-sessions
============================ */
router.get('/', validatePaginationParams, getLabSessions);

/* ============================
   GET SINGLE LAB SESSION
   GET /labs/:labId/lab-sessions/:id
============================ */
router.get('/:id', validateObjectId('id'), getLabSessionDetail);

/* ============================
   GET AVAILABLE ITEMS FOR LAB
   GET /labs/:labId/items/available
============================ */
router.get('/items/available', getLabAvailableItems);

module.exports = router;
