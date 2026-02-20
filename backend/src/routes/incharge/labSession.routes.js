const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueLabSession,
  getAvailableLabItems,
  searchLabItems,
  getActiveLabSessions 
} = require('../../controllers/incharge.controller');

// 🔐 Incharge only
router.use(auth, role('incharge'));

/* ============================
   LAB SESSION ROUTES
============================ */

// 1️⃣ Get all available items (for cart)
router.get('/items/available', getAvailableLabItems);

// 2️⃣ Search available items
router.get('/items/search', searchLabItems);

// 3️⃣ Issue lab session items
router.post('/issue', issueLabSession);

router.get('/active', getActiveLabSessions);

module.exports = router;
