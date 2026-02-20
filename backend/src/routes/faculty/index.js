const express = require('express');
const router = express.Router();

/* ============================
   ROUTE STRUCTURE
============================ */

router.use('/', require('./approval.routes'));     // Public token approval
router.use('/auth', require('./auth.routes'));     // Faculty auth
router.use('/dashboard', require('./dashboard.routes')); // Protected dashboard

module.exports = router;
