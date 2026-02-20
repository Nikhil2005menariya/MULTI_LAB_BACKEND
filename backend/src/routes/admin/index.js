const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

// 🔒 Protect ALL admin routes
router.use(auth, role('admin'));

const itemRoutes = require('./items.routes');
const transactionRoutes = require('./transactions.routes');
const overdueRoutes = require('./overdue.routes');
const damagedAssetsRoutes = require('./damagedAssets.routes');
const profileRoutes = require('./profile.routes');
const labTransactionRoutes = require('./labTransactions.routes');
const componentrequest=require('./componentRequest.routes');
const billRoutes=require('./bills.routes');

router.use('/analysis', require('../../analysis/analysis.routes'));
router.use('/items', itemRoutes);
router.use('/transactions', transactionRoutes);
router.use('/overdue', overdueRoutes);
router.use('/damaged-assets', damagedAssetsRoutes);
router.use('/damaged-assets', require('./damagedAssetHistory.routes'));
router.use('/profile', profileRoutes);
router.use('/lab-transactions', labTransactionRoutes);
router.use('/component-requests', componentrequest);
router.use('/bills', billRoutes);


module.exports = router;
