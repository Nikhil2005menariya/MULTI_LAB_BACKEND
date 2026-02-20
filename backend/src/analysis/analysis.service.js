const Transaction = require('../models/Transaction');
const Item = require('../models/Item');

/* ===============================
   BORROW ACTIVITY OVER TIME
=============================== */
exports.getBorrowActivity = async (days) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

/* ===============================
   MOST BORROWED ITEMS
=============================== */
exports.getMostBorrowedItems = async (days) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.item_id',
        totalQuantity: { $sum: '$items.quantity' }
      }
    },
    {
      $lookup: {
        from: 'items',
        localField: '_id',
        foreignField: '_id',
        as: 'item'
      }
    },
    { $unwind: '$item' },
    {
      $project: {
        _id: 0,
        item_name: '$item.name',
        sku: '$item.sku',
        tracking_type: '$item.tracking_type',
        totalQuantity: 1
      }
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: 10 }
  ]);
};

/* ===============================
   LOW STOCK ITEMS
=============================== */
exports.getLowStockItems = async () => {
  return Item.aggregate([
    {
      $match: { is_active: true }
    },
    {
      $match: {
        $expr: {
          $lte: ['$available_quantity', '$min_threshold_quantity']
        }
      }
    },
    {
      $project: {
        name: 1,
        sku: 1,
        vendor: 1,
        tracking_type: 1,
        available_quantity: 1,
        min_threshold_quantity: 1
      }
    }
  ]);
};

/* ===============================
   VENDOR-WISE DEMAND
=============================== */
exports.getVendorDemand = async (days) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'items',
        localField: 'items.item_id',
        foreignField: '_id',
        as: 'item'
      }
    },
    { $unwind: '$item' },
    {
      $group: {
        _id: '$item.vendor',
        totalBorrowed: { $sum: '$items.quantity' }
      }
    },
    { $sort: { totalBorrowed: -1 } }
  ]);
};

/* ===============================
   APPROVED BUT NOT ISSUED (QUEUE)
=============================== */
exports.getApprovalQueueStats = async (days) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return Transaction.aggregate([
    {
      $match: {
        status: 'approved',
        createdAt: { $gte: startDate }
      }
    },
    {
      $addFields: {
        waitingDays: {
          $dateDiff: {
            startDate: '$faculty_approval.approved_at',
            endDate: new Date(),
            unit: 'day'
          }
        }
      }
    },
    {
      $group: {
        _id: null,
        totalWaiting: { $sum: 1 },
        avgWaitingDays: { $avg: '$waitingDays' },
        maxWaitingDays: { $max: '$waitingDays' }
      }
    }
  ]);
};

