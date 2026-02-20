const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');
const upload = require('../../middlewares/billUpload.middleware');

const {
  uploadBill,
  getBills,
  downloadBill
} = require('../../controllers/admin.controller');

router.use(auth, role('admin'));

router.post('/', upload.single('file'), uploadBill);
router.get('/', getBills);
router.get('/:id/download', downloadBill);

module.exports = router;
