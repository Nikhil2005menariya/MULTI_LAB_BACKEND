// src/jobs/autoReject.job.js

const cron = require('node-cron');
const mongoose = require('mongoose');

const Transaction = require('../models/Transaction');
const LabInventory = require('../models/LabInventory');

const autoRejectExpiredTransactions = async () => {
  const session = await mongoose.startSession();

  try {
    const now = new Date();

    const raisedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const approvedCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    await session.startTransaction();

    const transactions = await Transaction.find({
      $or: [
        { status: 'raised', createdAt: { $lte: raisedCutoff } },
        { status: 'approved', updatedAt: { $lte: approvedCutoff } }
      ]
    }).session(session);

    for (const txn of transactions) {

      for (const txnItem of txn.items) {

        const { item_id, lab_id, quantity } = txnItem;

        const labInventory = await LabInventory.findOne({
          lab_id,
          item_id
        }).session(session);

        if (labInventory) {

          labInventory.temp_reserved_quantity =
            (labInventory.temp_reserved_quantity || 0) - quantity;

          if (labInventory.temp_reserved_quantity < 0) {
            labInventory.temp_reserved_quantity = 0;
          }

          await labInventory.save({ session });
        }
      }

      txn.status = 'rejected';
      txn.rejection_reason = 'Auto-rejected due to inactivity';
      await txn.save({ session });

      console.log(`Auto-rejected transaction ${txn.transaction_id}`);
    }

    await session.commitTransaction();
    session.endSession();

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Auto reject cron failed:', err);
  }
};

const startAutoRejectJob = () => {

  // 🕕 Run daily at 6 PM
  cron.schedule('0 18 * * *', async () => {
    console.log('Running auto-reject cron job...');
    await autoRejectExpiredTransactions();
  });

};

module.exports = startAutoRejectJob;