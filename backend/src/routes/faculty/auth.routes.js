const express = require('express');
const router = express.Router();

const facultyAuthController = require('../../controllers/faculty.controller');

/* ============================
   FACULTY AUTH ROUTES
============================ */

// Register (send verification email)
router.post('/register', facultyAuthController.registerFaculty);

// Verify email
router.get('/verify', facultyAuthController.verifyEmail);

// Set password (after verification)
router.post('/set-password', facultyAuthController.setPassword);

// Login
router.post('/login', facultyAuthController.loginFaculty);

module.exports = router;
