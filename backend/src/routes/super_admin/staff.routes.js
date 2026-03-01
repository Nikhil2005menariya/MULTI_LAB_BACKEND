const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getLabStaff,
  addAssistant,
  removeAssistant,
  changeIncharge,
  getCurrentIncharge
} = require('../../controllers/super_admin.controller');

router.use(auth, role('super_admin'));

/* Get lab staff */
router.get('/:labId/staff', getLabStaff);

/* Add assistant */
router.post('/:labId/assistants', addAssistant);

/* Remove assistant */
router.delete('/:labId/assistants/:staffId', removeAssistant);

/* Change incharge (only one allowed) */
router.post('/:labId/incharge', changeIncharge);

/*get current incharge*/
router.get('/:labId/incharge', getCurrentIncharge);

module.exports = router;