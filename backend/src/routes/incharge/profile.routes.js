const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const {
  changeInchargePassword,
  requestInchargeEmailOTP,
  updateInchargeEmail,
} = require('../../controllers/auth.controller');

// 🔒 incharge only
router.use(auth, role('incharge'));

router.post('/password', changeInchargePassword);
router.post('/request-otp', requestInchargeEmailOTP);
router.post('/email', updateInchargeEmail);

module.exports = router;
