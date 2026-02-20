const express = require('express');
const router = express.Router();

router.use('/admin', require('./admin'));
router.use('/student', require('./student'));
router.use('/auth/staff', require('./auth/staff.routes'));
router.use('/auth/student', require('./auth/student.routes'));
router.use('/faculty', require('./faculty'));
router.use('/incharge', require('./incharge'));




module.exports = router;
