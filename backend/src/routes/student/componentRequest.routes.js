const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  requestComponent,
  getMyComponentRequests,
} = require('../../controllers/student.controller');

// Student only
router.use(auth, role('student'));

router.post('/', requestComponent);
router.get('/', getMyComponentRequests);

module.exports = router;
