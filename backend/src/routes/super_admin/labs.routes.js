const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  createLab,
  getAllLabs,
  removeLab,
  activateLab
} = require('../../controllers/super_admin.controller');

router.use(auth, role('super_admin'));

router.post('/',                createLab);
router.get('/',                 getAllLabs);
router.delete('/:labId',        removeLab);
router.patch('/:labId/activate', activateLab);

module.exports = router;