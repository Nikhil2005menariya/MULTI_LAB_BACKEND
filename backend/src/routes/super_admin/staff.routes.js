const express = require('express');
const router = express.Router({ mergeParams: true });

const { validateObjectId } = require('../../middlewares/paramValidator.middleware');

const {
  getLabStaff,
  addAssistant,
  removeAssistant,
  changeIncharge,
  getCurrentIncharge
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB STAFF MANAGEMENT
   Mounted at: /api/super-admin/labs/:labId
   Auth applied at index.js level
===================================================== */

/* ============================
   GET ALL STAFF
   GET /labs/:labId/staff
============================ */
router.get('/staff', getLabStaff);

/* ============================
   GET CURRENT INCHARGE
   GET /labs/:labId/incharge
============================ */
router.get('/incharge', getCurrentIncharge);

/* ============================
   ADD ASSISTANT
   POST /labs/:labId/assistants
============================ */
router.post('/assistants', addAssistant);

/* ============================
   REMOVE ASSISTANT
   DELETE /labs/:labId/assistants/:staffId
============================ */
router.delete('/assistants/:staffId', validateObjectId('staffId'), removeAssistant);

/* ============================
   CHANGE INCHARGE
   POST /labs/:labId/incharge
============================ */
router.post('/incharge', changeIncharge);

module.exports = router;
