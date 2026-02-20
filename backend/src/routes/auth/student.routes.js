const express = require('express');
const router = express.Router();

const {
  registerStudent,
  verifyStudentEmail,
  studentLogin,
  studentForgotPassword,
  studentResetPassword
} = require('../../controllers/auth.controller');

router.post('/register', registerStudent);
router.get('/verify-email', verifyStudentEmail);
router.post('/login', studentLogin);
router.post('/forgot-password', studentForgotPassword);
router.post('/reset-password', studentResetPassword);

module.exports = router;
