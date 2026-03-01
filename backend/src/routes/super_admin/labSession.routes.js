const express = require('express');
const router = express.Router({ mergeParams: true });

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const {
  issueLabSession,
  getAvailableLabItems,
  searchLabItems,
  getActiveLabSessions
} = require('../../controllers/super_admin.controller');

router.use(auth, role('super_admin'));

/* Available items */
router.get('/items/available', getAvailableLabItems);

/* Search items */
router.get('/items/search', searchLabItems);

/* Issue lab session */
// router.post('/issue', issueLabSession);

/* Active sessions */
router.get('/active', getActiveLabSessions);

module.exports = router;