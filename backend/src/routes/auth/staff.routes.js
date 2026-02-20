const express = require('express');
const router = express.Router();

// middlewares
const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

// controllers
const {
  staffLogin,
  adminLogin,
} = require('../../controllers/auth.controller');

// ================= AUTH ROUTES =================

// Staff / Admin login
router.post('/login', staffLogin);
// If you have a separate admin login, uncomment this
// router.post('/admin/login', adminLogin);



// ================= PROTECTED ROUTES =================
// Admin + In-charge only


module.exports = router;
