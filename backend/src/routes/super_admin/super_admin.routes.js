const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const superAdminController = require('../../controllers/super_admin.controller');

/* =====================================================
   PROTECT ALL ROUTES
===================================================== */
router.use(auth, role('super_admin'));

/* =====================================================
   ================= GLOBAL LAB MANAGEMENT =================
===================================================== */

/* Create new lab */
router.post('/labs', superAdminController.createLab);

/* View all labs with statistics */
router.get('/labs', superAdminController.getAllLabs);

/* Remove (deactivate) lab */
router.delete('/labs/:labId', superAdminController.removeLab);


/* =====================================================
   ================= LAB STAFF MANAGEMENT =================
===================================================== */

/* Get staff of a specific lab */
router.get('/labs/:labId/staff', superAdminController.getLabStaff);

/* Add assistant to lab */
router.post('/labs/:labId/assistants', superAdminController.addAssistant);

/* Remove assistant from lab */
router.delete(
  '/labs/:labId/assistants/:staffId',
  superAdminController.removeAssistant
);

/* Change lab incharge (only one allowed) */
router.post(
  '/labs/:labId/incharge',
  superAdminController.changeIncharge
);


/* =====================================================
   ================= LAB-SCOPED OPERATIONS =================
   Super Admin acts as Lab Incharge
===================================================== */

/* Transactions */
router.post(
  '/labs/:labId/transactions/:transaction_id/issue',
  superAdminController.issueTransaction
);

router.post(
  '/labs/:labId/transactions/:transaction_id/return',
  superAdminController.returnTransaction
);

router.get(
  '/labs/:labId/transactions/active',
  superAdminController.getActiveTransactions
);

router.get(
  '/labs/:labId/transactions/pending',
  superAdminController.getPendingTransactions
);

/* Assets */
router.get(
  '/labs/:labId/items/:itemId/assets',
  superAdminController.getAvailableAssetsByItem
);

/* Lab session borrow */
router.post(
  '/labs/:labId/lab-session/issue',
  superAdminController.issueLabSession
);

router.get(
  '/labs/:labId/lab-session/active',
  superAdminController.getActiveLabSessions
);

/* Inventory */
router.get(
  '/labs/:labId/items',
  superAdminController.getAvailableLabItems
);

router.get(
  '/labs/:labId/items/search',
  superAdminController.searchLabItems
);

/* Lab transfer */
router.post(
  '/labs/:labId/lab-transfer',
  superAdminController.issueLabTransfer
);

router.get(
  '/labs/:labId/lab-transfer/active',
  superAdminController.getActiveLabTransfers
);

module.exports = router;