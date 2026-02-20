const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  getAvailableItemsForStudent
} = require('../../controllers/student.controller');

// student only
router.use(auth, role('student'));

router.get('/', getAvailableItemsForStudent);

module.exports = router;
