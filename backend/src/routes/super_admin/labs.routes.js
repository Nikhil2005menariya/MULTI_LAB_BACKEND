const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  createLab,
  getAllLabs,
  removeLab
} = require('../../controllers/super_admin.controller');

router.use(auth, role('super_admin'));

/* Create lab */
router.post('/', createLab);

/* View all labs with stats */
router.get('/', getAllLabs);

/* Deactivate lab */
router.delete('/:labId', removeLab);

module.exports = router;