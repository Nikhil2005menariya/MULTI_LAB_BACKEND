const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  createLab,
  getAllLabs,
  removeLab
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LAB MANAGEMENT
===================================================== */

router.use(auth, role('super_admin'));

/* ============================
   CREATE NEW LAB
   POST /api/super-admin/labs
============================ */
router.post('/', createLab);

/* ============================
   GET ALL LABS WITH STATS
   GET /api/super-admin/labs
============================ */
router.get('/', getAllLabs);

/* ============================
   DEACTIVATE LAB (SAFE DELETE)
   DELETE /api/super-admin/labs/:labId
============================ */
router.delete('/:labId', removeLab);

module.exports = router;