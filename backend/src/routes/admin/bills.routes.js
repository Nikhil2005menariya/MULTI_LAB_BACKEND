const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const upload = require('../../middlewares/billUpload.middleware');
const { validatePDFContent, handleUploadError } = require('../../middlewares/billUpload.middleware');
const { validateObjectId } = require('../../middlewares/paramValidator.middleware');
const { uploadLimiter } = require('../../middlewares/rateLimiter.middleware');

const {
  uploadBill,
  getBills,
  downloadBill
} = require('../../controllers/admin.controller');

router.use(auth, role('incharge'));

// Upload bill with rate limit and PDF validation
router.post('/', uploadLimiter, upload.single('file'), handleUploadError, validatePDFContent, uploadBill);

// Get all bills
router.get('/', getBills);

// Download bill by ID with validation
router.get('/:id/download', validateObjectId('id'), downloadBill);

module.exports = router;
