const express = require('express');
const router = express.Router();

const { apiLimiter } = require('../middlewares/rateLimiter.middleware');

// Apply general API rate limiting to all routes
router.use(apiLimiter);

// Auth routes (have their own specific rate limiters)
router.use('/auth/staff', require('./auth/staff.routes'));
router.use('/auth/student', require('./auth/student.routes'));
router.use('/auth/faculty', require('./auth/faculty.routes'));

// Protected role-based routes
router.use('/admin', require('./admin'));
router.use('/student', require('./student'));
router.use('/faculty', require('./faculty'));
router.use('/assistant', require('./assistant'));
router.use('/super-admin', require('./super_admin'));


module.exports = router;
