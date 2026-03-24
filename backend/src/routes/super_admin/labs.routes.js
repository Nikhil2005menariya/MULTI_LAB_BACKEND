const express = require('express');
const router = express.Router();

const {
  validateLabId,
  validatePaginationParams
} = require('../../middlewares/paramValidator.middleware');

const {
  createLab,
  getAllLabs,
  removeLab,
  activateLab
} = require('../../controllers/super_admin.controller');

/* =====================================================
   SUPER ADMIN – LABS MANAGEMENT
   Auth applied at index.js level
===================================================== */

router.post('/', createLab);
router.get('/', validatePaginationParams, getAllLabs);
router.delete('/:labId', validateLabId('labId'), removeLab);
router.patch('/:labId/activate', validateLabId('labId'), activateLab);

module.exports = router;
