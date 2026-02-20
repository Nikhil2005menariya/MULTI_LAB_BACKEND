const express = require('express');
const router = express.Router();

const auth = require('../middlewares/auth.middleware');
const role = require('../middlewares/role.middleware');

const {
  getAnalysisOverview,
  getLLMReport
} = require('./analysis.controller');

router.get(
  '/overview',
  auth,
  role('admin'),
  getAnalysisOverview
);

router.get(
  '/llm-report',
  auth,
  role('admin'),
  getLLMReport
);

module.exports = router;
