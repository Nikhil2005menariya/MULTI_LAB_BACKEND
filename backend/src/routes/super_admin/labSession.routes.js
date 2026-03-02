const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getLabSessions,
  getLabSessionDetail,
  getLabAvailableItems
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB SESSION ROUTES
   Base: /api/super-admin/labs/:labId/lab-sessions
===================================================== */

router.use(auth, role('super_admin'));

/* ============================
   GET ALL LAB SESSIONS
   GET /labs/:labId/lab-sessions
============================ */
router.get('/', getLabSessions);

/* ============================
   GET SINGLE LAB SESSION
   GET /labs/:labId/lab-sessions/:id
============================ */
router.get('/:id', getLabSessionDetail);

/* ============================
   GET AVAILABLE ITEMS FOR LAB
   GET /labs/:labId/items/available
============================ */
router.get('/items/available', getLabAvailableItems);

module.exports = router;